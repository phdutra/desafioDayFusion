using Amazon.Rekognition;
using Amazon.Rekognition.Model;
using DayFusion.API.Models;
using Microsoft.Extensions.Logging;

namespace DayFusion.API.Services;

public interface IFaceMatchService
{
    Task<MatchFromLivenessResponse> MatchFromLivenessAsync(
        MatchFromLivenessRequest request,
        double livenessScore);
}

public class FaceMatchService : IFaceMatchService
{
    private readonly IAmazonRekognition _rekognition;
    private readonly ILogger<FaceMatchService> _logger;

    public FaceMatchService(IAmazonRekognition rekognition, ILogger<FaceMatchService> logger)
    {
        _rekognition = rekognition;
        _logger = logger;
    }

    public async Task<MatchFromLivenessResponse> MatchFromLivenessAsync(
        MatchFromLivenessRequest request,
        double livenessScore)
    {
        var (docBucket, docKey) = ParseS3Path(request.DocumentImageS3Path);

        _logger.LogInformation(
            "Starting face match from liveness. SessionId: {SessionId}, Document: s3://{Bucket}/{Key}, AuditImages: {Count}",
            request.SessionId, docBucket, docKey, request.AuditImages.Count);

        var matches = new List<MatchDetailDto>();
        double bestSimilarity = 0;
        string? bestKey = null;

        foreach (var auditImg in request.AuditImages)
        {
            try
            {
                var compareRequest = new CompareFacesRequest
                {
                    SourceImage = new Image
                    {
                        S3Object = new S3Object
                        {
                            Bucket = auditImg.Bucket,
                            Name = auditImg.Key
                        }
                    },
                    TargetImage = new Image
                    {
                        S3Object = new S3Object
                        {
                            Bucket = docBucket,
                            Name = docKey
                        }
                    },
                    SimilarityThreshold = 70f
                };

                var compareResponse = await _rekognition.CompareFacesAsync(compareRequest);

                var bestFace = compareResponse.FaceMatches
                    .OrderByDescending(f => f.Similarity)
                    .FirstOrDefault();

                if (bestFace != null)
                {
                    var similarity = bestFace.Similarity ?? 0;
                    var confidence = bestFace.Face?.Confidence ?? 0;

                    _logger.LogInformation(
                        "Match found for audit image {Key}: Similarity={Similarity}%, Confidence={Confidence}%",
                        auditImg.Key, similarity, confidence);

                    matches.Add(new MatchDetailDto
                    {
                        ImageKey = auditImg.Key,
                        Similarity = similarity,
                        Confidence = confidence
                    });

                    if (similarity > bestSimilarity)
                    {
                        bestSimilarity = similarity;
                        bestKey = auditImg.Key;
                    }
                }
                else
                {
                    _logger.LogWarning("No face match found for audit image {Key}", auditImg.Key);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error comparing faces for audit image {Key}", auditImg.Key);
                // Continuar com próximo
            }
        }

        // Calcular score final: 60% liveness + 40% match
        var finalScore = (livenessScore * 0.6) + (bestSimilarity * 0.4);

        _logger.LogInformation(
            "Face match completed. SessionId: {SessionId}, BestMatch: {BestMatch}%, FinalScore: {FinalScore}%",
            request.SessionId, bestSimilarity, finalScore);

        return new MatchFromLivenessResponse
        {
            SessionId = request.SessionId,
            LivenessScore = livenessScore,
            BestMatchScore = bestSimilarity,
            BestMatchImageKey = bestKey,
            Matches = matches,
            FinalScore = finalScore
        };
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

