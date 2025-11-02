using Amazon.Rekognition;
using Amazon.Rekognition.Model;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;

namespace DayFusion.API.Controllers;

/// <summary>
/// Controller dedicado para Face Liveness 3D seguindo padrão do documento
/// Rotas: /api/liveness/session e /api/liveness/results
/// </summary>
[ApiController]
[Route("api/liveness")]
public class LivenessController : ControllerBase
{
    private readonly IAmazonRekognition _rekognitionClient;
    private readonly IAmazonS3 _s3Client;
    private readonly IConfiguration _configuration;
    private readonly ILogger<LivenessController> _logger;
    private readonly string _bucketName;

    public LivenessController(
        IAmazonRekognition rekognitionClient,
        IAmazonS3 s3Client,
        IConfiguration configuration,
        ILogger<LivenessController> logger)
    {
        _rekognitionClient = rekognitionClient;
        _s3Client = s3Client;
        _configuration = configuration;
        _logger = logger;
        _bucketName = _configuration["AWS:S3Bucket"] ?? _configuration["AWS_S3_BUCKET"]
            ?? throw new ArgumentNullException("AWS:S3Bucket", "Configure 'AWS:S3Bucket' em appsettings ou 'AWS_S3_BUCKET' env var.");
    }

    /// <summary>
    /// Cria uma sessão de Face Liveness 3D
    /// Conforme documento: POST /api/liveness/session
    /// </summary>
    [HttpPost("session")]
    public async Task<IActionResult> CreateSession()
    {
        try
        {
            _logger.LogInformation("Creating Face Liveness session");

            var request = new CreateFaceLivenessSessionRequest
            {
                Settings = new CreateFaceLivenessSessionRequestSettings
                {
                    AuditImagesLimit = 4
                    // Nota: ChallengePreferences pode não estar disponível no SDK 4.0.3
                    // Se necessário, atualize para SDK mais recente ou configure via OutputConfig
                }
                // Opcional: OutputConfig para salvar direto em S3
                // OutputConfig = new LivenessOutputConfig { S3Bucket = _bucketName, S3KeyPrefix = "liveness/raw" }
            };

            var response = await _rekognitionClient.CreateFaceLivenessSessionAsync(request);
            
            _logger.LogInformation("Face Liveness session created. SessionId: {SessionId}", response.SessionId);

            return Ok(new { sessionId = response.SessionId });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error creating Face Liveness session");
            return StatusCode(500, new { message = "Erro ao criar sessão de liveness", error = ex.Message });
        }
    }

    /// <summary>
    /// Busca resultados da sessão de Liveness e salva imagens no S3
    /// Conforme documento: GET /api/liveness/results?sessionId=xxx
    /// </summary>
    [HttpGet("results")]
    public async Task<IActionResult> GetResults([FromQuery] string sessionId)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(sessionId))
                return BadRequest(new { message = "sessionId obrigatório." });

            _logger.LogInformation("Getting Face Liveness results for session: {SessionId}", sessionId);

            var getResultsRequest = new GetFaceLivenessSessionResultsRequest
            {
                SessionId = sessionId
            };

            var result = await _rekognitionClient.GetFaceLivenessSessionResultsAsync(getResultsRequest);

            // Salva imagens no S3 (Reference + Audit) conforme documento
            var prefix = $"liveness/{sessionId}";

            // Reference image
            string? referenceKey = null;
            if (result.ReferenceImage != null && result.ReferenceImage.Bytes != null)
            {
                referenceKey = $"{prefix}/reference.jpg";
                
                // Converter MemoryStream para byte array
                var bytes = new byte[result.ReferenceImage.Bytes.Length];
                result.ReferenceImage.Bytes.Position = 0;
                result.ReferenceImage.Bytes.Read(bytes, 0, (int)result.ReferenceImage.Bytes.Length);
                
                await _s3Client.PutObjectAsync(new PutObjectRequest
                {
                    BucketName = _bucketName,
                    Key = referenceKey,
                    InputStream = new MemoryStream(bytes),
                    ContentType = "image/jpeg"
                });
                _logger.LogInformation("Reference image saved to S3: {Key}", referenceKey);
            }

            // Audit images - conforme documento usa audit_{i}.jpg
            var auditKeys = new List<string>();
            if (result.AuditImages != null)
            {
                int i = 0;
                foreach (var img in result.AuditImages)
                {
                    if (img.Bytes != null && img.Bytes.Length > 0)
                    {
                        var key = $"{prefix}/audit_{i++}.jpg";
                        
                        // Converter MemoryStream para byte array
                        var bytes = new byte[img.Bytes.Length];
                        img.Bytes.Position = 0;
                        img.Bytes.Read(bytes, 0, (int)img.Bytes.Length);
                        
                        await _s3Client.PutObjectAsync(new PutObjectRequest
                        {
                            BucketName = _bucketName,
                            Key = key,
                            InputStream = new MemoryStream(bytes),
                            ContentType = "image/jpeg"
                        });
                        auditKeys.Add(key);
                        _logger.LogInformation("Audit image {Index} saved to S3: {Key}", i - 1, key);
                    }
                }
            }

            var confidence = result.Confidence ?? 0f;
            var status = result.Status ?? "UNKNOWN";
            var decision = confidence >= 0.90f 
                ? "LIVE" 
                : (status == "SUCCEEDED" && confidence < 0.90f ? "SPOOF" : "UNKNOWN");
            
            // Análise detalhada do score (mesma lógica do RekognitionService)
            var lowScoreReasons = new List<string>();
            var recommendations = new List<string>();
            float? qualityScore = null;
            string? qualityAssessment = null;
            
            if (confidence < 0.90f)
            {
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

            _logger.LogInformation("Face Liveness results processed. SessionId: {SessionId}, Confidence: {Confidence}, Status: {Status}, Decision: {Decision}",
                sessionId, confidence, status, decision);

            // Gerar presigned URLs para as imagens
            var referenceImageUrl = referenceKey != null 
                ? await GeneratePresignedUrlAsync(referenceKey, 60) 
                : null;
            
            var auditImageUrls = new List<string>();
            foreach (var key in auditKeys)
            {
                var url = await GeneratePresignedUrlAsync(key, 60);
                auditImageUrls.Add(url);
            }

            return Ok(new
            {
                sessionId,
                status,
                livenessDecision = decision,
                confidence,
                message = decision == "LIVE" 
                    ? $"Liveness verificado com {confidence * 100:F1}% de confiança."
                    : decision == "SPOOF"
                    ? $"Possível tentativa de spoof detectada. Confiança: {confidence * 100:F1}%"
                    : $"Status da sessão: {status}. Confiança: {confidence * 100:F1}%",
                referenceImageUrl,
                auditImageUrls,
                lowScoreReasons,
                recommendations,
                qualityScore,
                qualityAssessment
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error getting Face Liveness results for session: {SessionId}", sessionId);
            return StatusCode(500, new { message = "Erro ao obter resultados de liveness", error = ex.Message });
        }
    }

    private async Task<string> GeneratePresignedUrlAsync(string key, int expiryMinutes)
    {
        var request = new GetPreSignedUrlRequest
        {
            BucketName = _bucketName,
            Key = key,
            Verb = HttpVerb.GET,
            Expires = DateTime.UtcNow.AddMinutes(expiryMinutes)
        };

        return await _s3Client.GetPreSignedURLAsync(request);
    }
}

