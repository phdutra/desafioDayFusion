using Amazon.Rekognition;
using Amazon.Rekognition.Model;
using Amazon.S3;
using Amazon.S3.Model;
using DayFusion.API.Models;
using DayFusion.API.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using System.Collections.Generic;
using System.IO;
using System.Linq;

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
    private readonly IDynamoDBService _dynamoDbService;
    private readonly string _bucketName;

    private static readonly string[] VideoExtensions = { ".webm", ".mp4", ".mov", ".avi", ".mkv" };

    public LivenessController(
        IAmazonRekognition rekognitionClient,
        IAmazonS3 s3Client,
        IConfiguration configuration,
        ILogger<LivenessController> logger,
        IDynamoDBService dynamoDbService)
    {
        _rekognitionClient = rekognitionClient;
        _s3Client = s3Client;
        _configuration = configuration;
        _logger = logger;
        _dynamoDbService = dynamoDbService;
        _bucketName = _configuration["AWS:S3Bucket"] ?? _configuration["AWS_S3_BUCKET"]
            ?? throw new ArgumentNullException("AWS:S3Bucket", "Configure 'AWS:S3Bucket' em appsettings ou 'AWS_S3_BUCKET' env var.");
    }

    /// <summary>
    /// Lista sessões de liveness existentes no bucket S3 (capturas + vídeo).
    /// </summary>
    [HttpGet("history")]
    public async Task<IActionResult> GetLivenessHistory([FromQuery] int limit = 20, [FromQuery] int expiryMinutes = 30)
    {
        try
        {
            if (limit <= 0)
            {
                limit = 20;
            }

            if (expiryMinutes <= 0 || expiryMinutes > 1440)
            {
                expiryMinutes = 30;
            }

            var listRequest = new ListObjectsV2Request
            {
                BucketName = _bucketName,
                Prefix = "liveness/"
            };

            var allObjects = new List<Amazon.S3.Model.S3Object>();
            ListObjectsV2Response listResponse;

            do
            {
                listResponse = await _s3Client.ListObjectsV2Async(listRequest);
                allObjects.AddRange(listResponse.S3Objects.Where(obj => !obj.Key.EndsWith("/", StringComparison.OrdinalIgnoreCase)));
                listRequest.ContinuationToken = listResponse.NextContinuationToken;
            } while (listResponse.IsTruncated == true && allObjects.Count < limit * 50);

            var groupedSessions = allObjects
                .Select(obj => new { Object = obj, SessionId = ExtractSessionId(obj.Key) })
                .Where(x => !string.IsNullOrWhiteSpace(x.SessionId))
                .GroupBy(x => x.SessionId!)
                .Select(group => new
                {
                    SessionId = group.Key,
                    Objects = group.Select(x => x.Object).OrderBy(o => o.LastModified).ToList(),
                    Latest = group.Max(o => o.Object.LastModified)
                })
                .OrderByDescending(g => g.Latest)
                .Take(limit)
                .ToList();

            var results = new List<LivenessHistoryItem>();

            foreach (var group in groupedSessions)
            {
                var item = await BuildHistoryItemAsync(group.SessionId, group.Objects, expiryMinutes);
                if (item != null)
                {
                    results.Add(item);
                }
            }

            return Ok(results);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Erro ao listar histórico de liveness do S3.");
            return StatusCode(500, new { message = "Erro ao listar histórico de liveness.", error = ex.Message });
        }
    }

    /// <summary>
    /// Endpoint auxiliar para validação de rota.
    /// </summary>
    [HttpGet("ping")]
    public IActionResult Ping()
    {
        return Ok(new { message = "liveness ok" });
    }

    /// <summary>
    /// Cria uma sessão de Face Liveness 3D
    /// Conforme documento: POST /api/liveness/start
    /// </summary>
    [HttpPost("start")]
    public async Task<IActionResult> StartSession()
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

            // Retornar formato compatível com LivenessSessionResponse do frontend
            // O widget AWS Face Liveness espera este formato exato
            var transactionId = Guid.NewGuid().ToString();
            var expiresAt = DateTime.UtcNow.AddMinutes(3); // Sessões são válidas por 3 minutos conforme AWS
            
            _logger.LogInformation("Face Liveness session created. SessionId: {SessionId}, TransactionId: {TransactionId}, ExpiresAt: {ExpiresAt}", 
                response.SessionId, transactionId, expiresAt);
            
            await EnsureLivenessTransactionPlaceholderAsync(response.SessionId);

            return Ok(new 
            { 
                sessionId = response.SessionId,
                streamingUrl = string.Empty, // AWS Rekognition não retorna streaming URL diretamente
                transactionId = transactionId,
                expiresAt = expiresAt.ToString("O") // ISO 8601 format
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error creating Face Liveness session");
            return StatusCode(500, new { message = "Erro ao criar sessão de liveness", error = ex.Message });
        }
    }

    /// <summary>
    /// Cria uma sessão de Face Liveness 3D (alias para compatibilidade)
    /// POST /api/liveness/session
    /// </summary>
    [HttpPost("session")]
    public async Task<IActionResult> CreateSession()
    {
        return await StartSession();
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

            // Polling para aguardar conclusão da sessão (máximo 30 segundos, intervalos de 2s)
            var maxAttempts = 15;
            var attempt = 0;
            GetFaceLivenessSessionResultsResponse? result = null;
            
            while (attempt < maxAttempts)
            {
                var getResultsRequest = new GetFaceLivenessSessionResultsRequest
                {
                    SessionId = sessionId
                };

                result = await _rekognitionClient.GetFaceLivenessSessionResultsAsync(getResultsRequest);
                // Garantir que status seja sempre string (pode vir como enum do AWS SDK)
                var currentStatus = result.Status?.ToString() ?? "UNKNOWN";
                
                _logger.LogInformation("Session {SessionId} status check #{Attempt}: Status={Status}, Confidence={Confidence}, ReferenceImage={HasRef}, AuditCount={AuditCount}", 
                    sessionId, attempt + 1, currentStatus, result.Confidence ?? 0f,
                    result.ReferenceImage != null && result.ReferenceImage.Bytes != null && result.ReferenceImage.Bytes.Length > 0,
                    result.AuditImages?.Count ?? 0);
                
                // Log adicional quando status é CREATED (sessão criada mas sem vídeo ainda)
                if (currentStatus == "CREATED")
                {
                    _logger.LogWarning("Session {SessionId} ainda em CREATED após {Attempt} tentativas. Possíveis causas: widget não enviou vídeo, WebRTC não conectou, ou sessão expirou.", 
                        sessionId, attempt + 1);
                }
                
                // Se sessão foi concluída (SUCCEEDED, FAILED, EXPIRED) ou ainda não iniciou (CREATED), processar
                if (currentStatus != "IN_PROGRESS")
                {
                    _logger.LogInformation("Session {SessionId} completed with status: {Status}", sessionId, currentStatus);
                    break;
                }
                
                // Aguardar 2 segundos antes da próxima tentativa
                await Task.Delay(2000);
                attempt++;
            }

            if (result == null)
            {
                return StatusCode(500, new { message = $"Não foi possível obter resultados da sessão {sessionId} após {maxAttempts} tentativas" });
            }
            
            // Garantir que status seja sempre string (pode vir como enum do AWS SDK)
            var finalStatus = result.Status?.ToString() ?? "UNKNOWN";
            var finalConfidence = result.Confidence ?? 0f;
            var hasReferenceImage = result.ReferenceImage != null && result.ReferenceImage.Bytes != null && result.ReferenceImage.Bytes.Length > 0;
            var auditCount = result.AuditImages?.Count ?? 0;
            
            _logger.LogInformation("📊 Final session status: {Status}, Confidence: {Confidence} ({ConfidencePercent}%), ReferenceImage present: {HasRef}, AuditImages count: {AuditCount}",
                finalStatus, finalConfidence, finalConfidence * 100, hasReferenceImage, auditCount);
            
            // Diagnóstico específico para status CREATED
            if (finalStatus == "CREATED")
            {
                _logger.LogWarning("⚠️ PROBLEMA: Sessão permanece em CREATED. Isso significa que o WebRTC não foi estabelecido corretamente.");
                _logger.LogWarning("🔍 Possíveis causas:");
                _logger.LogWarning("   1. Widget AWS Face Liveness não foi inicializado corretamente");
                _logger.LogWarning("   2. WebRTC não conectou (requer HTTPS ou localhost)");
                _logger.LogWarning("   3. Cognito Identity Pool não configurado ou sem permissões");
                _logger.LogWarning("   4. Vídeo não foi transmitido do frontend para AWS Rekognition");
                _logger.LogWarning("   5. Sessão expirou (válida por apenas 3 minutos)");
                _logger.LogWarning("📋 Resultado: Confidence={Confidence}%, Status={Status}, HasImages={HasImages}", 
                    finalConfidence * 100, finalStatus, hasReferenceImage || auditCount > 0);
            }
            else if (finalStatus == "SUCCEEDED")
            {
                _logger.LogInformation("✅ Sessão concluída com sucesso! Confidence: {Confidence}%, ReferenceImage: {HasRef}, AuditImages: {Count}", 
                    finalConfidence * 100, hasReferenceImage, auditCount);
            }
            else if (finalStatus == "FAILED")
            {
                _logger.LogWarning("❌ Sessão falhou. Confidence: {Confidence}%, Status: {Status}", 
                    finalConfidence * 100, finalStatus);
            }

            // Salva imagens no S3 (Reference + Audit) conforme documento
            var prefix = $"liveness/{sessionId}";

            // Reference image
            string? referenceKey = null;
            if (result.ReferenceImage != null && result.ReferenceImage.Bytes != null)
            {
                var streamLength = result.ReferenceImage.Bytes.Length;
                _logger.LogInformation("ReferenceImage stream length: {Length} bytes for session: {SessionId}", 
                    streamLength, sessionId);
                
                if (streamLength > 0)
                {
                    referenceKey = $"{prefix}/reference.jpg";
                    
                    // Converter MemoryStream para byte array usando CopyTo para garantir integridade
                    result.ReferenceImage.Bytes.Position = 0;
                    using var memoryStream = new MemoryStream();
                    await result.ReferenceImage.Bytes.CopyToAsync(memoryStream);
                    var bytes = memoryStream.ToArray();
                    
                    _logger.LogInformation("ReferenceImage converted to byte array: {ByteLength} bytes for session: {SessionId}", 
                        bytes.Length, sessionId);
                    
                    if (bytes.Length > 0)
                    {
                        await _s3Client.PutObjectAsync(new PutObjectRequest
                        {
                            BucketName = _bucketName,
                            Key = referenceKey,
                            InputStream = new MemoryStream(bytes),
                            ContentType = "image/jpeg"
                        });
                        _logger.LogInformation("Reference image saved successfully ({Size} bytes) to S3: {Key}", bytes.Length, referenceKey);
                    }
                    else
                    {
                        _logger.LogWarning("ReferenceImage bytes array is empty for session: {SessionId}", sessionId);
                    }
                }
                else
                {
                    _logger.LogWarning("ReferenceImage stream is empty (length=0) for session: {SessionId}. Status: {Status}", 
                        sessionId, result.Status ?? "UNKNOWN");
                }
            }
            else
            {
                _logger.LogWarning("ReferenceImage is null or Bytes is null for session: {SessionId}. Status: {Status}", 
                    sessionId, result.Status ?? "UNKNOWN");
            }

            // Audit images - conforme documento usa audit_{i}.jpg
            var auditKeys = new List<string>();
            if (result.AuditImages != null && result.AuditImages.Count > 0)
            {
                _logger.LogInformation("Processing {Count} audit images for session: {SessionId}", 
                    result.AuditImages.Count, sessionId);
                
                int i = 0;
                foreach (var img in result.AuditImages)
                {
                    if (img.Bytes != null)
                    {
                        var streamLength = img.Bytes.Length;
                        _logger.LogInformation("AuditImage[{Index}] stream length: {Length} bytes for session: {SessionId}", 
                            i, streamLength, sessionId);
                        
                        if (streamLength > 0)
                        {
                            var key = $"{prefix}/audit_{i++}.jpg";
                            
                            // Converter MemoryStream para byte array usando CopyTo para garantir integridade
                            img.Bytes.Position = 0;
                            using var memoryStream = new MemoryStream();
                            await img.Bytes.CopyToAsync(memoryStream);
                            var bytes = memoryStream.ToArray();
                            
                            _logger.LogInformation("AuditImage[{Index}] converted to byte array: {ByteLength} bytes for session: {SessionId}", 
                                i - 1, bytes.Length, sessionId);
                            
                            if (bytes.Length > 0)
                            {
                                await _s3Client.PutObjectAsync(new PutObjectRequest
                                {
                                    BucketName = _bucketName,
                                    Key = key,
                                    InputStream = new MemoryStream(bytes),
                                    ContentType = "image/jpeg"
                                });
                                auditKeys.Add(key);
                                _logger.LogInformation("Audit image {Index} saved successfully ({Size} bytes) to S3: {Key}", 
                                    i - 1, bytes.Length, key);
                            }
                            else
                            {
                                _logger.LogWarning("AuditImage[{Index}] bytes array is empty for session: {SessionId}", i - 1, sessionId);
                            }
                        }
                        else
                        {
                            _logger.LogWarning("AuditImage[{Index}] stream is empty (length=0) for session: {SessionId}. Status: {Status}", 
                                i, sessionId, result.Status ?? "UNKNOWN");
                            i++; // Incrementar índice mesmo se vazio
                        }
                    }
                    else
                    {
                        _logger.LogWarning("AuditImage[{Index}] Bytes is null for session: {SessionId}", i, sessionId);
                        i++; // Incrementar índice mesmo se null
                    }
                }
            }
            else
            {
                _logger.LogWarning("No audit images available for session: {SessionId}. Status: {Status}, ReferenceImage present: {HasRef}", 
                    sessionId, result.Status ?? "UNKNOWN", 
                    result.ReferenceImage != null && result.ReferenceImage.Bytes != null && result.ReferenceImage.Bytes.Length > 0);
                
                // Se status não for SUCCEEDED, explicar por que não há thumbnails
                if (result.Status != "SUCCEEDED")
                {
                    _logger.LogWarning("Audit images are only generated when session status is SUCCEEDED. Current status: {Status} for session: {SessionId}", 
                        result.Status ?? "UNKNOWN", sessionId);
                }
            }

            var confidence = result.Confidence ?? 0f;
            // Garantir que status seja sempre string (pode vir como enum do AWS SDK)
            var status = result.Status?.ToString() ?? "UNKNOWN";
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

            var responsePayload = new
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
            };

            await PersistLivenessTransactionAsync(sessionId, referenceKey, confidence, status, decision);

            return Ok(responsePayload);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error getting Face Liveness results for session: {SessionId}", sessionId);
            return StatusCode(500, new { message = "Erro ao obter resultados de liveness", error = ex.Message });
        }
    }

    /// <summary>
    /// Compara a imagem de referência do Liveness com a foto do documento
    /// Conforme documento: POST /api/liveness/compare
    /// </summary>
    [HttpPost("compare")]
    public async Task<IActionResult> Compare([FromBody] LivenessCompareRequest req)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(req.SessionId))
                return BadRequest(new { message = "SessionId é obrigatório." });
            
            if (string.IsNullOrWhiteSpace(req.DocumentKey))
                return BadRequest(new { message = "DocumentKey é obrigatório." });

            _logger.LogInformation("Starting liveness comparison. SessionId: {SessionId}, DocumentKey: {DocumentKey}", 
                req.SessionId, req.DocumentKey);

            // 1) Obter resultados do Liveness (pega a ReferenceImage "viva")
            var result = await _rekognitionClient.GetFaceLivenessSessionResultsAsync(
                new GetFaceLivenessSessionResultsRequest { SessionId = req.SessionId });

            if (result.Confidence < 0.70f)
            {
                _logger.LogWarning("Liveness confidence too low: {Confidence} for session: {SessionId}", 
                    result.Confidence, req.SessionId);
                return Ok(new 
                { 
                    status = "reprovado", 
                    reason = "Liveness baixo", 
                    liveness = result.Confidence 
                });
            }

            // 2) Garantir que ReferenceImage está salva no S3
            var prefix = $"liveness/{req.SessionId}";
            var refKey = $"{prefix}/reference.jpg";
            
            // Verificar se já existe
            var refExists = await ObjectExistsAsync(refKey);
            
            if (!refExists && result.ReferenceImage != null && result.ReferenceImage.Bytes != null)
            {
                var streamLength = result.ReferenceImage.Bytes.Length;
                if (streamLength > 0)
                {
                    result.ReferenceImage.Bytes.Position = 0;
                    using var memoryStream = new MemoryStream();
                    await result.ReferenceImage.Bytes.CopyToAsync(memoryStream);
                    var bytes = memoryStream.ToArray();
                    
                    if (bytes.Length > 0)
                    {
                        await _s3Client.PutObjectAsync(new PutObjectRequest
                        {
                            BucketName = _bucketName,
                            Key = refKey,
                            InputStream = new MemoryStream(bytes),
                            ContentType = "image/jpeg"
                        });
                        _logger.LogInformation("Reference image saved to S3: {Key}", refKey);
                    }
                }
            }

            // 3) Comparar referência (source) com documento (target)
            var cmp = await _rekognitionClient.CompareFacesAsync(new CompareFacesRequest
            {
                SourceImage = new Image 
                { 
                    S3Object = new Amazon.Rekognition.Model.S3Object 
                    { 
                        Bucket = _bucketName, 
                        Name = refKey 
                    } 
                },
                TargetImage = new Image 
                { 
                    S3Object = new Amazon.Rekognition.Model.S3Object 
                    { 
                        Bucket = _bucketName, 
                        Name = req.DocumentKey 
                    } 
                },
                SimilarityThreshold = 80f
            });

            var match = cmp.FaceMatches.FirstOrDefault();
            var similarity = match?.Similarity ?? 0f;
            var status = (similarity >= 80f && result.Confidence >= 0.70f) ? "aprovado" : "reprovado";

            _logger.LogInformation("Liveness comparison completed. SessionId: {SessionId}, Liveness: {Liveness}, Similarity: {Similarity}, Status: {Status}",
                req.SessionId, result.Confidence, similarity, status);

            return Ok(new
            {
                status,
                liveness = result.Confidence,
                similarity,
                referenceKey = refKey,
                documentKey = req.DocumentKey,
                message = status == "aprovado"
                    ? $"Validação aprovada. Liveness: {result.Confidence * 100:F1}%, Similaridade: {similarity:F1}%"
                    : $"Validação reprovada. Liveness: {result.Confidence * 100:F1}%, Similaridade: {similarity:F1}%"
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error comparing liveness with document. SessionId: {SessionId}, DocumentKey: {DocumentKey}", 
                req.SessionId, req.DocumentKey);
            return StatusCode(500, new { message = "Erro ao comparar liveness com documento", error = ex.Message });
        }
    }

    private async Task<bool> ObjectExistsAsync(string key)
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

    private async Task<LivenessHistoryItem?> BuildHistoryItemAsync(string sessionId, List<Amazon.S3.Model.S3Object> objects, int expiryMinutes)
    {
        if (!objects.Any())
        {
            return null;
        }

        var captures = new List<LivenessHistoryCapture>();
        LivenessHistoryVideo? video = null;

        foreach (var obj in objects)
        {
            var fileName = Path.GetFileName(obj.Key);
            if (IsVideoFile(fileName))
            {
                var url = await GeneratePresignedUrlAsync(obj.Key, expiryMinutes);
                var size = obj.Size ?? 0;
                video = new LivenessHistoryVideo
                {
                    Key = obj.Key,
                    Url = url,
                    MimeType = GuessMimeType(fileName),
                    Size = size,
                    DurationSeconds = null
                };
                continue;
            }

            var captureUrl = await GeneratePresignedUrlAsync(obj.Key, expiryMinutes);
            var captureSize = obj.Size ?? 0;
            var captureLastModifiedUtc = obj.LastModified?.ToUniversalTime() ?? DateTime.UtcNow;

            captures.Add(new LivenessHistoryCapture
            {
                Key = obj.Key,
                Url = captureUrl,
                Position = InferPosition(fileName),
                Size = captureSize,
                LastModified = captureLastModifiedUtc
            });
        }

        if (!captures.Any() && video == null)
        {
            return null;
        }

        var createdAt = objects.Min(o => o.LastModified)?.ToUniversalTime() ?? DateTime.UtcNow;

        return new LivenessHistoryItem
        {
            SessionId = sessionId,
            CreatedAt = createdAt,
            Captures = captures.OrderBy(c => c.LastModified).ToList(),
            Video = video,
            LivenessScore = null,
            Status = "Revisar",
            Metadata = new Dictionary<string, string>
            {
                { "objectCount", objects.Count.ToString() }
            }
        };
    }

    private static string? ExtractSessionId(string key)
    {
        if (string.IsNullOrWhiteSpace(key))
        {
            return null;
        }

        var parts = key.Split('/', StringSplitOptions.RemoveEmptyEntries);
        return parts.Length >= 2 ? parts[1] : null;
    }

    private static bool IsVideoFile(string fileName)
    {
        var extension = Path.GetExtension(fileName);
        return !string.IsNullOrEmpty(extension) && VideoExtensions.Contains(extension, StringComparer.OrdinalIgnoreCase);
    }

    private static string GuessMimeType(string fileName)
    {
        var extension = Path.GetExtension(fileName).ToLowerInvariant();
        return extension switch
        {
            ".mp4" => "video/mp4",
            ".mov" => "video/quicktime",
            ".avi" => "video/x-msvideo",
            ".mkv" => "video/x-matroska",
            ".webm" => "video/webm",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".png" => "image/png",
            _ => "application/octet-stream"
        };
    }

    private static string? InferPosition(string fileName)
    {
        var name = Path.GetFileNameWithoutExtension(fileName);
        if (string.IsNullOrWhiteSpace(name))
        {
            return null;
        }

        if (name.Contains("reference", StringComparison.OrdinalIgnoreCase))
        {
            return "referencia";
        }

        if (name.StartsWith("audit_", StringComparison.OrdinalIgnoreCase))
        {
            return name;
        }

        var parts = name.Split('-', StringSplitOptions.RemoveEmptyEntries);
        return parts.Length > 1 ? parts.Last() : name;
    }

    private async Task EnsureLivenessTransactionPlaceholderAsync(string sessionId)
    {
        if (string.IsNullOrWhiteSpace(sessionId))
        {
            return;
        }

        try
        {
            var existing = await _dynamoDbService.GetTransactionAsync(sessionId);
            if (existing != null)
            {
                return;
            }

            var transaction = new Transaction
            {
                Id = sessionId,
                UserId = GetCurrentUserId(),
                SelfieUrl = string.Empty,
                DocumentUrl = string.Empty,
                Status = TransactionStatus.ManualReview,
                CreatedAt = DateTime.UtcNow,
                ProcessedAt = DateTime.UtcNow,
                AutoObservations = new List<string>
                {
                    "Sessão de liveness criada. Aguardando conclusão."
                }
            };

            await _dynamoDbService.CreateTransactionAsync(transaction);
            _logger.LogInformation("Placeholder transaction created for liveness session {SessionId}.", sessionId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to create placeholder transaction for liveness session {SessionId}", sessionId);
        }
    }

    private async Task PersistLivenessTransactionAsync(
        string sessionId,
        string? referenceKey,
        float confidence,
        string status,
        string decision)
    {
        try
        {
            Transaction? transaction = null;
            if (!string.IsNullOrWhiteSpace(sessionId))
            {
                transaction = await _dynamoDbService.GetTransactionAsync(sessionId);
            }
            var isNew = transaction == null;

            if (transaction == null)
            {
                transaction = new Transaction
                {
                    Id = sessionId,
                    UserId = GetCurrentUserId(),
                    SelfieUrl = referenceKey ?? string.Empty,
                    DocumentUrl = string.Empty,
                    CreatedAt = DateTime.UtcNow,
                    AutoObservations = new List<string>()
                };
            }

            if (!string.IsNullOrWhiteSpace(referenceKey))
            {
                transaction.SelfieUrl = referenceKey;
            }

            transaction.DocumentUrl ??= string.Empty;
            transaction.LivenessScore = confidence * 100f;
            transaction.ProcessedAt = DateTime.UtcNow;

            transaction.Status = decision switch
            {
                "LIVE" => TransactionStatus.Approved,
                "SPOOF" => TransactionStatus.Rejected,
                _ when string.Equals(status, "FAILED", StringComparison.OrdinalIgnoreCase) => TransactionStatus.Rejected,
                _ when string.Equals(status, "EXPIRED", StringComparison.OrdinalIgnoreCase) => TransactionStatus.Error,
                _ => TransactionStatus.ManualReview
            };

            var autoObservations = new List<string>();

            if (transaction.SimilarityScore is null && transaction.Status == TransactionStatus.Approved && confidence < 0.95f)
            {
                autoObservations.Add("Verificação de presença aprovada. Aguardando face match para completar análise.");
            }

            if (transaction.Status == TransactionStatus.Rejected)
            {
                var reason = $"Liveness detectou possível spoof (confiança {confidence * 100f:F1}%).";
                transaction.RejectionReason = reason;
                autoObservations.Add(reason);
            }
            else if (transaction.Status == TransactionStatus.Error)
            {
                var reason = $"Sessão de liveness finalizada com status {status}.";
                transaction.RejectionReason = reason;
                autoObservations.Add(reason);
            }
            else
            {
                transaction.RejectionReason = null;
            }

            if (string.IsNullOrWhiteSpace(transaction.UserId))
            {
                transaction.UserId = GetCurrentUserId();
            }

            if (transaction.CreatedAt == default)
            {
                transaction.CreatedAt = DateTime.UtcNow;
            }

            if (autoObservations.Count > 0)
            {
                transaction.AutoObservations ??= new List<string>();

                foreach (var observation in autoObservations)
                {
                    if (!transaction.AutoObservations.Contains(observation))
                    {
                        transaction.AutoObservations.Add(observation);
                    }
                }
            }

            if (isNew)
            {
                await _dynamoDbService.CreateTransactionAsync(transaction);
                _logger.LogInformation("Liveness session {SessionId} persisted as new transaction.", sessionId);
            }
            else
            {
                await _dynamoDbService.UpdateTransactionAsync(transaction);
                _logger.LogInformation("Liveness session {SessionId} updated in transactions table.", sessionId);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to persist liveness session {SessionId} into transactions table", sessionId);
        }
    }

    private string GetCurrentUserId()
    {
        return User?.FindFirst("sub")?.Value
            ?? User?.FindFirst("cognito:username")?.Value
            ?? User?.Identity?.Name
            ?? "anonymous";
    }
}

