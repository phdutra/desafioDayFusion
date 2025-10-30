using Amazon.Rekognition;
using Amazon.Rekognition.Model;
using Amazon.S3;
using Amazon.S3.Model;
using DayFusion.API.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace DayFusion.API.Services;

public class RekognitionService : IRekognitionService
{
    private readonly IAmazonRekognition _rekognitionClient;
    private readonly IAmazonS3 _s3Client;
    private readonly IConfiguration _configuration;
    private readonly ILogger<RekognitionService> _logger;
    private readonly string _bucketName;

    // Thresholds for decision making
    private const float APPROVED_THRESHOLD = 99.0f;
    private const float MANUAL_REVIEW_THRESHOLD = 70.0f;

    public RekognitionService(
        IAmazonRekognition rekognitionClient,
        IAmazonS3 s3Client,
        IConfiguration configuration,
        ILogger<RekognitionService> logger)
    {
        _rekognitionClient = rekognitionClient;
        _s3Client = s3Client;
        _configuration = configuration;
        _logger = logger;
        _bucketName = _configuration["AWS:S3Bucket"] ?? _configuration["AWS_S3_BUCKET"]
            ?? throw new ArgumentNullException("AWS:S3Bucket", "Configure 'AWS:S3Bucket' in appsettings or 'AWS_S3_BUCKET' env var.");
    }

    public async Task<FaceComparisonResponse> CompareFacesAsync(FaceComparisonRequest request)
    {
        try
        {
            _logger.LogInformation("Starting face comparison for transaction: {TransactionId}", request.TransactionId);

            // Download images from S3
            var selfieImage = await GetImageFromS3Async(request.SelfieKey);
            var documentImage = await GetImageFromS3Async(request.DocumentKey);

            // Compare faces
            var similarityScore = await GetFaceSimilarityAsync(selfieImage, documentImage);

            // Determine status based on similarity score
            var status = DetermineStatus(similarityScore);

            var response = new FaceComparisonResponse
            {
                SimilarityScore = similarityScore,
                Status = status,
                TransactionId = request.TransactionId ?? Guid.NewGuid().ToString(),
                Message = GetStatusMessage(status, similarityScore)
            };

            _logger.LogInformation("Face comparison completed. Score: {Score}, Status: {Status}", 
                similarityScore, status);

            return response;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error during face comparison for transaction: {TransactionId}", request.TransactionId);
            
            return new FaceComparisonResponse
            {
                SimilarityScore = 0,
                Status = TransactionStatus.Error,
                TransactionId = request.TransactionId ?? Guid.NewGuid().ToString(),
                Message = "Error processing face comparison"
            };
        }
    }

    public async Task<bool> DetectFacesAsync(string imageKey)
    {
        try
        {
            var image = await GetImageFromS3Async(imageKey);
            
            var request = new DetectFacesRequest
            {
                Image = new Image { Bytes = new MemoryStream(image) },
                Attributes = new List<string> { "ALL" }
            };

            var response = await _rekognitionClient.DetectFacesAsync(request);
            
            _logger.LogInformation("Face detection completed for key: {Key}. Faces found: {Count}", 
                imageKey, response.FaceDetails.Count);

            return response.FaceDetails.Any();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error detecting faces for key: {Key}", imageKey);
            return false;
        }
    }

    public async Task<float> GetFaceSimilarityAsync(string sourceImageKey, string targetImageKey)
    {
        try
        {
            var sourceImage = await GetImageFromS3Async(sourceImageKey);
            var targetImage = await GetImageFromS3Async(targetImageKey);

            return await GetFaceSimilarityAsync(sourceImage, targetImage);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error getting face similarity between {SourceKey} and {TargetKey}", 
                sourceImageKey, targetImageKey);
            return 0f;
        }
    }

    private async Task<float> GetFaceSimilarityAsync(byte[] sourceImage, byte[] targetImage)
    {
        var request = new CompareFacesRequest
        {
            SourceImage = new Image { Bytes = new MemoryStream(sourceImage) },
            TargetImage = new Image { Bytes = new MemoryStream(targetImage) },
            SimilarityThreshold = 0F
        };

        var response = await _rekognitionClient.CompareFacesAsync(request);
        
        if (response.FaceMatches.Any())
        {
            return response.FaceMatches.Max(m => m.Similarity);
        }

        return 0f;
    }

    private async Task<byte[]> GetImageFromS3Async(string key)
    {
        var request = new GetObjectRequest
        {
            BucketName = _bucketName,
            Key = key
        };

        using var response = await _s3Client.GetObjectAsync(request);
        using var memoryStream = new MemoryStream();
        await response.ResponseStream.CopyToAsync(memoryStream);
        return memoryStream.ToArray();
    }

    private static TransactionStatus DetermineStatus(float similarityScore)
    {
        return similarityScore switch
        {
            >= APPROVED_THRESHOLD => TransactionStatus.Approved,
            >= MANUAL_REVIEW_THRESHOLD => TransactionStatus.ManualReview,
            _ => TransactionStatus.Rejected
        };
    }

    private static string GetStatusMessage(TransactionStatus status, float score)
    {
        return status switch
        {
            TransactionStatus.Approved => $"Faces match with {score:F1}% confidence. Transaction approved.",
            TransactionStatus.ManualReview => $"Faces match with {score:F1}% confidence. Manual review required.",
            TransactionStatus.Rejected => $"Faces match with {score:F1}% confidence. Transaction rejected.",
            _ => "Unable to process face comparison."
        };
    }
}
