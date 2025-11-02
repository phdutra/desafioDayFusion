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
            
            if (image == null || image.Length == 0)
            {
                _logger.LogWarning("Image is empty or null for key: {Key}", imageKey);
                return false;
            }
            
            var request = new DetectFacesRequest
            {
                Image = new Image { Bytes = new MemoryStream(image) },
                Attributes = new List<string> { "ALL" }
            };

            var response = await _rekognitionClient.DetectFacesAsync(request);
            
            var faceCount = response.FaceDetails?.Count ?? 0;
            
            _logger.LogInformation("Face detection completed for key: {Key}. Faces found: {Count}, Image size: {Size} bytes", 
                imageKey, faceCount, image.Length);

            // Verificar se encontrou pelo menos uma face com qualidade mínima
            if (faceCount > 0 && response.FaceDetails != null)
            {
                var bestFace = response.FaceDetails
                    .Where(f => f != null)
                    .OrderByDescending(f => f.Confidence ?? 0)
                    .FirstOrDefault();
                
                var confidence = bestFace?.Confidence ?? 0;
                
                // Obter métricas de qualidade do AWS Rekognition
                var brightness = bestFace?.Quality?.Brightness ?? 0f;
                var sharpness = bestFace?.Quality?.Sharpness ?? 0f;
                
                _logger.LogInformation("Best face - Confidence: {Confidence}%, Brightness: {Brightness}, Sharpness: {Sharpness}", 
                    confidence, brightness, sharpness);
                
                // Lógica mais permissiva: se confiança >= 50%, aceitar independente de qualidade
                // O AWS Rekognition já é rigoroso na detecção, então se detectou, provavelmente está OK
                if (confidence >= 50f)
                {
                    // Se tem iluminação muito ruim (<20 ou >95), ainda rejeitar
                    var isIlluminationExtreme = brightness < 20f || brightness > 95f;
                    
                    if (isIlluminationExtreme)
                    {
                        _logger.LogWarning("Face detected but extreme illumination issue - Brightness: {Brightness}", brightness);
                        return false;
                    }
                    
                    _logger.LogInformation("Face detected and accepted - Confidence: {Confidence}%, Brightness: {Brightness}, Sharpness: {Sharpness}", 
                        confidence, brightness, sharpness);
                    return true;
                }
                else
                {
                    _logger.LogWarning("Face detected but confidence too low: {Confidence}%", confidence);
                }
            }

            return false;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error detecting faces for key: {Key}. Error: {Error}", imageKey, ex.Message);
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
            return response.FaceMatches.Max(m => m.Similarity ?? 0f);
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

    // Face Liveness 3D Implementation
    public async Task<LivenessSessionResponse> StartFaceLivenessSessionAsync(StartLivenessRequest request)
    {
        try
        {
            _logger.LogInformation("Starting Face Liveness session for transaction: {TransactionId}", request.TransactionId);

            var createRequest = new Amazon.Rekognition.Model.CreateFaceLivenessSessionRequest
            {
                ClientRequestToken = Guid.NewGuid().ToString(),
                Settings = new Amazon.Rekognition.Model.CreateFaceLivenessSessionRequestSettings
                {
                    AuditImagesLimit = 4
                    // Nota: ChallengePreferences e OutputConfig podem não estar disponíveis no SDK 4.0.3
                    // As imagens serão salvas manualmente quando buscar os resultados
                }
            };

            var response = await _rekognitionClient.CreateFaceLivenessSessionAsync(createRequest);

            _logger.LogInformation("Face Liveness session started. SessionId: {SessionId}", response.SessionId);

            return new LivenessSessionResponse
            {
                SessionId = response.SessionId,
                StreamingUrl = string.Empty, // Client uses Amplify to get streaming URL
                TransactionId = request.TransactionId ?? Guid.NewGuid().ToString(),
                ExpiresAt = DateTime.UtcNow.AddMinutes(15)
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error starting Face Liveness session for transaction: {TransactionId}", request.TransactionId);
            throw;
        }
    }

    public async Task<LivenessResultResponse> GetFaceLivenessSessionResultsAsync(GetLivenessResultRequest request)
    {
        try
        {
            _logger.LogInformation("Getting Face Liveness results for session: {SessionId}", request.SessionId);

            var getResultsRequest = new Amazon.Rekognition.Model.GetFaceLivenessSessionResultsRequest
            {
                SessionId = request.SessionId
            };

            var response = await _rekognitionClient.GetFaceLivenessSessionResultsAsync(getResultsRequest);

            var status = response.Status ?? "UNKNOWN";
            var confidence = response.Confidence ?? 0f;
            var decision = confidence >= 0.90f 
                ? "LIVE" 
                : (response.Status == "SUCCEEDED" && confidence < 0.90f ? "SPOOF" : "UNKNOWN");
            
            // Análise detalhada do score
            var lowScoreReasons = new List<string>();
            var recommendations = new List<string>();
            float? qualityScore = null;
            string? qualityAssessment = null;
            
            if (confidence < 0.90f)
            {
                // Analisar razões para score baixo
                if (confidence < 0.50f)
                {
                    lowScoreReasons.Add("Confiança muito baixa (<50%)");
                    lowScoreReasons.Add("Possível tentativa de spoof detectada");
                    recommendations.Add("Certifique-se de que está em um ambiente bem iluminado");
                    recommendations.Add("Posicione o rosto no centro da tela");
                    recommendations.Add("Evite usar óculos escuros ou máscaras");
                    recommendations.Add("Mantenha o rosto imóvel durante a captura");
                    qualityAssessment = "POOR";
                    qualityScore = confidence * 100;
                }
                else if (confidence < 0.70f)
                {
                    lowScoreReasons.Add("Confiança moderada (50-70%)");
                    lowScoreReasons.Add("Pode indicar condições subótimas de captura");
                    recommendations.Add("Melhore a iluminação do ambiente");
                    recommendations.Add("Mantenha uma distância adequada da câmera");
                    recommendations.Add("Evite reflexos ou sombras no rosto");
                    qualityAssessment = "FAIR";
                    qualityScore = confidence * 100;
                }
                else
                {
                    lowScoreReasons.Add("Confiança abaixo do ideal (70-90%)");
                    recommendations.Add("Posicione-se melhor em relação à câmera");
                    recommendations.Add("Mantenha um fundo neutro");
                    recommendations.Add("Evite movimentos bruscos");
                    qualityAssessment = "GOOD";
                    qualityScore = confidence * 100;
                }
                
                // Adicionar razões baseadas no status
                if (status != "SUCCEEDED")
                {
                    lowScoreReasons.Add($"Status da sessão: {status}");
                    recommendations.Add("Tente iniciar uma nova verificação");
                }
            }
            else
            {
                qualityAssessment = "EXCELLENT";
                qualityScore = confidence * 100;
            }
            
            var message = decision == "LIVE" 
                ? $"Liveness verificado com {confidence * 100:F1}% de confiança."
                : decision == "SPOOF"
                ? $"Possível tentativa de spoof detectada. Confiança: {confidence * 100:F1}%"
                : $"Status da sessão: {status}. Confiança: {confidence * 100:F1}%";

            // Salvar imagens no S3 e buscar URLs (conforme documento)
            var auditImageUrls = new List<string>();
            string? referenceImageUrl = null;
            var prefix = $"liveness/{request.SessionId}";

            try
            {
                // Salvar Reference image no S3
                var referenceKey = $"{prefix}/reference.jpg";
                if (response.ReferenceImage != null && response.ReferenceImage.Bytes != null && response.ReferenceImage.Bytes.Length > 0)
                {
                    // Converter MemoryStream para byte array
                    var bytes = new byte[response.ReferenceImage.Bytes.Length];
                    response.ReferenceImage.Bytes.Position = 0;
                    response.ReferenceImage.Bytes.Read(bytes, 0, (int)response.ReferenceImage.Bytes.Length);
                    
                    // Salvar no S3
                    await _s3Client.PutObjectAsync(new Amazon.S3.Model.PutObjectRequest
                    {
                        BucketName = _bucketName,
                        Key = referenceKey,
                        InputStream = new MemoryStream(bytes),
                        ContentType = "image/jpeg"
                    });
                    
                    // Gerar presigned URL
                    referenceImageUrl = await GeneratePresignedUrlAsync(referenceKey, 60);
                    _logger.LogInformation("Reference image saved and URL generated for session: {SessionId}", request.SessionId);
                }
                else if (await S3ObjectExistsAsync(referenceKey))
                {
                    // Se já existe no S3, apenas gerar URL
                    referenceImageUrl = await GeneratePresignedUrlAsync(referenceKey, 60);
                    _logger.LogInformation("Reference image found in S3 for session: {SessionId}", request.SessionId);
                }

                // Salvar Audit images no S3 (conforme documento usa audit_{i}.jpg)
                if (response.AuditImages != null)
                {
                    int i = 0;
                    foreach (var img in response.AuditImages)
                    {
                        if (img.Bytes != null && img.Bytes.Length > 0)
                        {
                            var auditKey = $"{prefix}/audit_{i++}.jpg";
                            
                            // Converter MemoryStream para byte array
                            var bytes = new byte[img.Bytes.Length];
                            img.Bytes.Position = 0;
                            img.Bytes.Read(bytes, 0, (int)img.Bytes.Length);
                            
                            // Salvar no S3
                            await _s3Client.PutObjectAsync(new Amazon.S3.Model.PutObjectRequest
                            {
                                BucketName = _bucketName,
                                Key = auditKey,
                                InputStream = new MemoryStream(bytes),
                                ContentType = "image/jpeg"
                            });
                            
                            // Gerar presigned URL
                            var auditUrl = await GeneratePresignedUrlAsync(auditKey, 60);
                            auditImageUrls.Add(auditUrl);
                            _logger.LogInformation("Audit image {Index} saved and URL generated for session: {SessionId}", i - 1, request.SessionId);
                        }
                    }
                }
                
                // Fallback: tentar buscar do S3 se já existirem (compatibilidade)
                if (auditImageUrls.Count == 0)
                {
                    for (int i = 0; i < 4; i++)
                    {
                        var auditKey = $"{prefix}/audit_{i}.jpg";
                        if (await S3ObjectExistsAsync(auditKey))
                        {
                            var auditUrl = await GeneratePresignedUrlAsync(auditKey, 60);
                            auditImageUrls.Add(auditUrl);
                        }
                    }
                }

                _logger.LogInformation("Processed {Count} audit images for session: {SessionId}", auditImageUrls.Count, request.SessionId);
            }
            catch (Exception exImages)
            {
                _logger.LogWarning(exImages, "Failed to save/retrieve audit/reference images for session: {SessionId}", request.SessionId);
                // Não falha o request se não conseguir as imagens
            }

            _logger.LogInformation("Face Liveness results. SessionId: {SessionId}, Status: {Status}, Decision: {Decision}, Confidence: {Confidence}",
                request.SessionId, status, decision, confidence);

            return new LivenessResultResponse
            {
                SessionId = request.SessionId,
                Status = status,
                LivenessDecision = decision,
                Confidence = confidence,
                TransactionId = request.TransactionId ?? string.Empty,
                Message = message,
                ReferenceImageUrl = referenceImageUrl,
                AuditImageUrls = auditImageUrls,
                LowScoreReasons = lowScoreReasons,
                Recommendations = recommendations,
                QualityScore = qualityScore,
                QualityAssessment = qualityAssessment
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error getting Face Liveness results for session: {SessionId}", request.SessionId);
            throw;
        }
    }

    private async Task<bool> S3ObjectExistsAsync(string key)
    {
        try
        {
            await _s3Client.GetObjectMetadataAsync(_bucketName, key);
            return true;
        }
        catch (Amazon.S3.AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return false;
        }
    }

    private async Task<string> GeneratePresignedUrlAsync(string key, int expiryMinutes)
    {
        var request = new Amazon.S3.Model.GetPreSignedUrlRequest
        {
            BucketName = _bucketName,
            Key = key,
            Verb = HttpVerb.GET,
            Expires = DateTime.UtcNow.AddMinutes(expiryMinutes)
        };

        return await _s3Client.GetPreSignedURLAsync(request);
    }
}
