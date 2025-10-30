using DayFusion.API.Models;
using DayFusion.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DayFusion.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[AllowAnonymous]
public class StorageController : ControllerBase
{
    private readonly IS3Service _s3Service;
    private readonly ILogger<StorageController> _logger;

    public StorageController(IS3Service s3Service, ILogger<StorageController> logger)
    {
        _s3Service = s3Service;
        _logger = logger;
    }

    /// <summary>
    /// Uploads a file directly via API (multipart/form-data). Backend streams to S3.
    /// </summary>
    // Backward-compatible route: both /upload and /files/upload
    [HttpPost("upload")]
    [HttpPost("files/upload")]
    [RequestSizeLimit(10 * 1024 * 1024)] // 10MB safety cap
    public async Task<ActionResult<PresignedUrlResponse>> Upload([FromForm] IFormFile file, [FromForm] string? transactionId)
    {
        if (file == null || file.Length == 0)
        {
            return BadRequest("File is required");
        }
        if (!IsValidImageType(file.ContentType))
        {
            return BadRequest("Invalid file type. Only images are allowed.");
        }

        try
        {
            _logger.LogInformation("Starting upload. File={FileName} ContentType={ContentType} SizeBytes={Size} TransactionId={TransactionId}", file.FileName, file.ContentType, file.Length, transactionId);
            await using var stream = file.OpenReadStream();
            var result = await _s3Service.UploadObjectAsync(stream, file.FileName, file.ContentType, transactionId);
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error uploading file {File} ContentType={ContentType} SizeBytes={Size}", file.FileName, file.ContentType, file.Length);
            return StatusCode(500, "Internal server error");
        }
    }

    /// <summary>
    /// Generate a presigned URL for uploading files to S3
    /// </summary>
    [HttpPost("presigned-url")]
    public async Task<ActionResult<PresignedUrlResponse>> GeneratePresignedUrl([FromBody] PresignedUrlRequest request)
    {
        try
        {
            if (!IsValidImageType(request.ContentType))
            {
                return BadRequest("Invalid file type. Only images are allowed.");
            }

            var response = await _s3Service.GeneratePresignedPutUrlAsync(request);
            return Ok(response);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error generating presigned URL for file: {FileName}", request.FileName);
            return StatusCode(500, "Internal server error");
        }
    }

    /// <summary>
    /// Generate a presigned URL for downloading files from S3
    /// </summary>
    // Catch-all para caminho: útil quando o cliente envia a chave no path
    [HttpGet("presigned-url/{*key}")]
    public async Task<ActionResult<PresignedUrlResponse>> GenerateDownloadUrl(string key, [FromQuery] int expiryMinutes = 60)
    {
        try
        {
            var expiry = TimeSpan.FromMinutes(expiryMinutes);
            var response = await _s3Service.GeneratePresignedGetUrlAsync(key, expiry);
            return Ok(response);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error generating download URL for key: {Key}", key);
            return StatusCode(500, "Internal server error");
        }
    }

    /// <summary>
    /// Generate a presigned URL (querystring version) to suportar chaves com barras codificadas (%2F)
    /// </summary>
    [HttpGet("presigned-url")] // uso: /api/storage/presigned-url?key=<s3-key>&expiryMinutes=60
    public async Task<ActionResult<PresignedUrlResponse>> GenerateDownloadUrlQuery([FromQuery] string key, [FromQuery] int expiryMinutes = 60)
    {
        try
        {
            var expiry = TimeSpan.FromMinutes(expiryMinutes);
            var response = await _s3Service.GeneratePresignedGetUrlAsync(key, expiry);
            return Ok(response);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error generating download URL (query) for key: {Key}", key);
            return StatusCode(500, "Internal server error");
        }
    }

    /// <summary>
    /// Generate a presigned URL (POST body version) para evitar problemas de encoding e permitir futura evolução
    /// </summary>
    [HttpPost("presigned-url/get")]
    public async Task<ActionResult<PresignedUrlResponse>> GenerateDownloadUrlBody([FromBody] PresignedGetRequest body)
    {
        try
        {
            var expiry = TimeSpan.FromMinutes(body.ExpiryMinutes <= 0 ? 60 : body.ExpiryMinutes);
            var normalizedKey = Uri.UnescapeDataString(body.Key ?? string.Empty).TrimStart('/');
            _logger.LogInformation("Generating GET presigned URL. Key={Key}", normalizedKey);
            var response = await _s3Service.GeneratePresignedGetUrlAsync(normalizedKey, expiry);
            return Ok(response);
        }
        catch (Amazon.S3.AmazonS3Exception s3ex)
        {
            _logger.LogError(s3ex, "S3 error generating download URL (body) for key: {Key}", body.Key);
            return StatusCode((int)System.Net.HttpStatusCode.BadGateway, s3ex.Message);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error generating download URL (body) for key: {Key}", body.Key);
            return StatusCode(500, ex.Message);
        }
    }

    /// <summary>
    /// Delete a file from S3
    /// </summary>
    [HttpDelete("{key}")]
    public async Task<ActionResult> DeleteFile(string key)
    {
        try
        {
            var success = await _s3Service.DeleteObjectAsync(key);
            if (success)
            {
                return NoContent();
            }
            return NotFound();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting file with key: {Key}", key);
            return StatusCode(500, "Internal server error");
        }
    }

    /// <summary>
    /// Check if a file exists in S3
    /// </summary>
    [HttpGet("exists/{key}")]
    public async Task<ActionResult<bool>> FileExists(string key)
    {
        try
        {
            var exists = await _s3Service.ObjectExistsAsync(key);
            return Ok(exists);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error checking if file exists with key: {Key}", key);
            return StatusCode(500, "Internal server error");
        }
    }

    private static bool IsValidImageType(string contentType)
    {
        var validTypes = new[]
        {
            "image/jpeg",
            "image/jpg",
            "image/png",
            "image/webp"
        };

        return validTypes.Contains(contentType.ToLowerInvariant());
    }
}
