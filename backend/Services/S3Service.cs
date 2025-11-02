using Amazon.S3;
using Amazon.S3.Model;
using DayFusion.API.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace DayFusion.API.Services;

public class S3Service : IS3Service
{
    private readonly IAmazonS3 _s3Client;
    private readonly IConfiguration _configuration;
    private readonly ILogger<S3Service> _logger;
    private readonly string _bucketName;

    public S3Service(IAmazonS3 s3Client, IConfiguration configuration, ILogger<S3Service> logger)
    {
        _s3Client = s3Client;
        _configuration = configuration;
        _logger = logger;
        var configuredBucket = _configuration["AWS:S3Bucket"] ?? _configuration["AWS_S3_BUCKET"];
        if (string.IsNullOrWhiteSpace(configuredBucket))
        {
            throw new ArgumentNullException("AWS:S3Bucket", "Configure 'AWS:S3Bucket' in appsettings or 'AWS_S3_BUCKET' as environment variable.");
        }
        _bucketName = configuredBucket;
    }

    public async Task<PresignedUrlResponse> GeneratePresignedPutUrlAsync(PresignedUrlRequest request)
    {
        try
        {
            var key = GenerateKey(request.FileName, request.TransactionId);
            var expiry = TimeSpan.FromMinutes(15);

            var presignedRequest = new GetPreSignedUrlRequest
            {
                BucketName = _bucketName,
                Key = key,
                Verb = HttpVerb.PUT,
                Expires = DateTime.UtcNow.Add(expiry),
                // Important: the content type used to sign must match the header sent by the client
                ContentType = string.IsNullOrWhiteSpace(request.ContentType) ? "application/octet-stream" : request.ContentType
            };

            // Optionally enable SSE via configuration (useful in prod; off in local dev to avoid extra CORS headers)
            var enableSse = bool.TryParse(_configuration["AWS:EnableSse"], out var sseFlag) && sseFlag;
            if (enableSse)
            {
                presignedRequest.ServerSideEncryptionMethod = ServerSideEncryptionMethod.AES256;
            }

            var url = await _s3Client.GetPreSignedURLAsync(presignedRequest);

            _logger.LogInformation("Generated presigned PUT URL for key: {Key}", key);

            return new PresignedUrlResponse
            {
                Url = url,
                Key = key,
                ExpiresAt = DateTime.UtcNow.Add(expiry)
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error generating presigned PUT URL for file: {FileName}", request.FileName);
            throw;
        }
    }

    public async Task<PresignedUrlResponse> GeneratePresignedGetUrlAsync(string key, TimeSpan expiry)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(key))
            {
                throw new ArgumentException("S3 key is required", nameof(key));
            }
            var presignedRequest = new GetPreSignedUrlRequest
            {
                BucketName = _bucketName,
                Key = key,
                Verb = HttpVerb.GET,
                Expires = DateTime.UtcNow.Add(expiry)
            };

            var url = await _s3Client.GetPreSignedURLAsync(presignedRequest);

            _logger.LogInformation("Generated presigned GET URL for key: {Key}", key);

            return new PresignedUrlResponse
            {
                Url = url,
                Key = key,
                ExpiresAt = DateTime.UtcNow.Add(expiry)
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error generating presigned GET URL for key: {Key}", key);
            throw;
        }
    }

    public async Task<bool> DeleteObjectAsync(string key)
    {
        try
        {
            var request = new DeleteObjectRequest
            {
                BucketName = _bucketName,
                Key = key
            };

            await _s3Client.DeleteObjectAsync(request);
            _logger.LogInformation("Deleted object with key: {Key}", key);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting object with key: {Key}", key);
            return false;
        }
    }

    public async Task<bool> ObjectExistsAsync(string key)
    {
        try
        {
            var request = new GetObjectMetadataRequest
            {
                BucketName = _bucketName,
                Key = key
            };

            await _s3Client.GetObjectMetadataAsync(request);
            return true;
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return false;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error checking if object exists with key: {Key}", key);
            return false;
        }
    }

    private static string GenerateKey(string fileName, string? transactionId)
    {
        var timestamp = DateTime.UtcNow.ToString("yyyy/MM/dd");
        var fileExtension = Path.GetExtension(fileName);
        var baseFileName = Path.GetFileNameWithoutExtension(fileName);
        
        if (!string.IsNullOrEmpty(transactionId))
        {
            return $"transactions/{transactionId}/{baseFileName}{fileExtension}";
        }
        
        return $"uploads/{timestamp}/{Guid.NewGuid()}{fileExtension}";
    }

    public async Task<PresignedUrlResponse> UploadObjectAsync(Stream content, string fileName, string? contentType, string? transactionId)
    {
        var key = GenerateKey(fileName, transactionId);
        try
        {
            var resolvedContentType = string.IsNullOrWhiteSpace(contentType) ? "application/octet-stream" : contentType;
            _logger.LogInformation("Uploading object to S3. Bucket={Bucket} Key={Key} FileName={FileName} ContentType={ContentType}", _bucketName, key, fileName, resolvedContentType);

            var put = new PutObjectRequest
            {
                BucketName = _bucketName,
                Key = key,
                InputStream = content,
                ContentType = resolvedContentType
            };

            await _s3Client.PutObjectAsync(put);
            _logger.LogInformation("Successfully uploaded object. Key={Key}", key);

            string? previewUrl = null;
            try
            {
                // Try to generate a preview GET URL (best-effort only)
                previewUrl = await _s3Client.GetPreSignedURLAsync(new GetPreSignedUrlRequest
                {
                    BucketName = _bucketName,
                    Key = key,
                    Verb = HttpVerb.GET,
                    Expires = DateTime.UtcNow.AddMinutes(15)
                });
            }
            catch (AmazonS3Exception ex)
            {
                _logger.LogWarning(ex, "Could not generate preview GET URL. Returning key only. Bucket={Bucket} Key={Key}", _bucketName, key);
            }

            return new PresignedUrlResponse
            {
                Key = key,
                Url = previewUrl ?? string.Empty,
                ExpiresAt = DateTime.UtcNow.AddMinutes(15)
            };
        }
        catch (AmazonS3Exception ex)
        {
            _logger.LogError(ex, "S3 upload failed. Bucket={Bucket} Key={Key} StatusCode={StatusCode} ErrorCode={ErrorCode} Message={Message}", _bucketName, key, ex.StatusCode, ex.ErrorCode, ex.Message);
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unexpected error uploading to S3. Bucket={Bucket} Key={Key}", _bucketName, key);
            throw;
        }
    }
}
