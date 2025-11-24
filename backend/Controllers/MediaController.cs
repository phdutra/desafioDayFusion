using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DayFusion.API.Controllers;

[ApiController]
[Route("api/media")]
[AllowAnonymous]
public class MediaController : ControllerBase
{
    private readonly IAmazonS3 _s3;
    private readonly ILogger<MediaController> _logger;

    public MediaController(IAmazonS3 s3, ILogger<MediaController> logger)
    {
        _s3 = s3;
        _logger = logger;
    }

    [HttpGet("liveness-frame")]
    public async Task<IActionResult> GetLivenessFrame([FromQuery] string bucket, [FromQuery] string key)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(bucket) || string.IsNullOrWhiteSpace(key))
                return BadRequest(new { message = "bucket e key são obrigatórios." });

            var response = await _s3.GetObjectAsync(bucket, key);
            return File(response.ResponseStream, response.Headers.ContentType ?? "image/jpeg");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Erro ao obter liveness frame. Bucket: {Bucket}, Key: {Key}", bucket, key);
            return StatusCode(500, new { message = "Erro ao obter imagem", error = ex.Message });
        }
    }

    [HttpGet("document")]
    public async Task<IActionResult> GetDocumentImage([FromQuery] string path)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(path))
                return BadRequest(new { message = "path é obrigatório." });

            var (bucket, key) = ParseS3Path(path);
            var response = await _s3.GetObjectAsync(bucket, key);
            return File(response.ResponseStream, response.Headers.ContentType ?? "image/jpeg");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Erro ao obter documento. Path: {Path}", path);
            return StatusCode(500, new { message = "Erro ao obter documento", error = ex.Message });
        }
    }

    private static (string Bucket, string Key) ParseS3Path(string s3Path)
    {
        if (!s3Path.StartsWith("s3://", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Formato inválido de caminho S3", nameof(s3Path));

        var withoutPrefix = s3Path.Substring("s3://".Length);
        var firstSlash = withoutPrefix.IndexOf('/');
        if (firstSlash < 0)
            throw new ArgumentException("Formato inválido de caminho S3", nameof(s3Path));

        var bucket = withoutPrefix.Substring(0, firstSlash);
        var key = withoutPrefix.Substring(firstSlash + 1);
        return (bucket, key);
    }
}

