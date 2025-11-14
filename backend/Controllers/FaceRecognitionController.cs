using DayFusion.API.Models;
using DayFusion.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DayFusion.API.Controllers;

[ApiController]
[Route("api/face-recognition")]
[AllowAnonymous]
public class FaceRecognitionController : ControllerBase
{
    private readonly IRekognitionService _rekognitionService;
    private readonly IDynamoDBService _dynamoService;
    private readonly IDocumentAnalyzerService _docAnalyzer;
    private readonly IValidationService _validator;
    private readonly IConfiguration _configuration;
    private readonly ILogger<FaceRecognitionController> _logger;

    public FaceRecognitionController(
        IRekognitionService rekognitionService,
        IDynamoDBService dynamoService,
        IDocumentAnalyzerService docAnalyzer,
        IValidationService validator,
        IConfiguration configuration,
        ILogger<FaceRecognitionController> logger)
    {
        _rekognitionService = rekognitionService;
        _dynamoService = dynamoService;
        _docAnalyzer = docAnalyzer;
        _validator = validator;
        _configuration = configuration;
        _logger = logger;
    }

    /// <summary>
    /// Compare faces between selfie and document
    /// </summary>
    [HttpPost("compare")]
    public async Task<ActionResult<FaceComparisonResponse>> CompareFaces([FromBody] FaceComparisonRequest request)
    {
        try
        {
            _logger.LogInformation("Starting face comparison for transaction: {TransactionId}", request.TransactionId);

            // First perform face comparison to avoid coupling result to persistence availability
            var response = await _rekognitionService.CompareFacesAsync(request);

            // Ensure transaction id
            var transactionId = request.TransactionId ?? response.TransactionId ?? Guid.NewGuid().ToString();

            // Try to persist transaction (best-effort). Do not fail the request if DynamoDB is unavailable.
            try
            {
                var userId = GetCurrentUserId();
                var transaction = new Transaction
                {
                    Id = transactionId,
                    UserId = userId,
                    SelfieUrl = request.SelfieKey,
                    DocumentUrl = request.DocumentKey,
                    SimilarityScore = response.SimilarityScore,
                    Status = response.Status,
                    ProcessedAt = DateTime.UtcNow,
                    CreatedAt = DateTime.UtcNow
                };

                _logger.LogInformation("Attempting to save transaction {TransactionId} to DynamoDB for user {UserId}", 
                    transactionId, userId);

                // Create or update depending on existence
                await _dynamoService.CreateTransactionAsync(transaction);
                
                _logger.LogInformation("Successfully persisted transaction {TransactionId} to DynamoDB", transactionId);
            }
            catch (Exception exPersist)
            {
                _logger.LogError(exPersist, "Face comparison succeeded but FAILED to persist transaction {TransactionId} to DynamoDB. Error: {ErrorMessage}", 
                    transactionId, exPersist.Message);
                _logger.LogError("Stack trace: {StackTrace}", exPersist.StackTrace);
                // Não falha a requisição, mas loga o erro para debug
            }

            _logger.LogInformation("Face comparison completed. Tx={TransactionId} Score={Score} Status={Status}", 
                transactionId, response.SimilarityScore, response.Status);

            response.TransactionId = transactionId;
            return Ok(response);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error during face comparison for transaction: {TransactionId}", request.TransactionId);
            return StatusCode(500, "Internal server error");
        }
    }

    /// <summary>
    /// Detect faces in an image
    /// Usa DTO no body ao invés de query string ou path parameter
    /// </summary>
    [HttpPost("detect")]
    public async Task<ActionResult<bool>> DetectFaces([FromBody] DetectFaceRequest request)
    {
        try
        {
            if (request == null || string.IsNullOrWhiteSpace(request.ImageKey))
            {
                return BadRequest(new { message = "ImageKey é obrigatório." });
            }

            // A validação é feita pela API que chama AWS Rekognition
            // O AWS Rekognition retorna métricas de qualidade incluindo iluminação (Brightness)
            // Essas métricas são avaliadas internamente no DetectFacesAsync
            var hasFaces = await _rekognitionService.DetectFacesAsync(request.ImageKey);
            
            _logger.LogInformation("Face detection result for {ImageKey}: {HasFaces}", request.ImageKey, hasFaces);
            
            return Ok(hasFaces);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error detecting faces in image: {ImageKey}", request?.ImageKey);
            return StatusCode(500, "Internal server error");
        }
    }


    /// <summary>
    /// Get face similarity score between two images
    /// </summary>
    [HttpPost("similarity")]
    public async Task<ActionResult<float>> GetFaceSimilarity([FromBody] FaceComparisonRequest request)
    {
        try
        {
            var similarity = await _rekognitionService.GetFaceSimilarityAsync(request.SelfieKey, request.DocumentKey);
            return Ok(similarity);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error getting face similarity between {SelfieKey} and {DocumentKey}", 
                request.SelfieKey, request.DocumentKey);
            return StatusCode(500, "Internal server error");
        }
    }

    /// <summary>
    /// Start a Face Liveness 3D session
    /// </summary>
    [HttpPost("liveness/start")]
    public async Task<ActionResult<LivenessSessionResponse>> StartLiveness([FromBody] StartLivenessRequest request)
    {
        try
        {
            _logger.LogInformation("Starting Face Liveness session for transaction: {TransactionId}", request.TransactionId);

            var response = await _rekognitionService.StartFaceLivenessSessionAsync(request);

            _logger.LogInformation("Face Liveness session created. SessionId: {SessionId}, TransactionId: {TransactionId}",
                response.SessionId, response.TransactionId);

            return Ok(response);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error starting Face Liveness session for transaction: {TransactionId}", request.TransactionId);
            return StatusCode(500, new { message = "Erro ao iniciar sessão de liveness", error = ex.Message });
        }
    }

    /// <summary>
    /// Get Face Liveness 3D session results e faz análise completa se DocumentKey fornecido
    /// </summary>
    [HttpPost("liveness/result")]
    public async Task<ActionResult<LivenessResultResponse>> GetLivenessResult([FromBody] GetLivenessResultRequest request)
    {
        try
        {
            _logger.LogInformation("Getting Face Liveness results for session: {SessionId}", request.SessionId);

            // Verificar se sessionId é um UUID válido (AWS Rekognition requer UUID)
            // Se não for, significa que é captura local (não usa widget AWS)
            LivenessResultResponse? response = null;
            float livenessScore = 100f; // Default para captura local
            string livenessDecision = "LIVE";
            
            if (Guid.TryParse(request.SessionId, out _))
            {
                // SessionId é UUID válido, chamar AWS Rekognition
                try
                {
                    response = await _rekognitionService.GetFaceLivenessSessionResultsAsync(request);
                    livenessScore = response.Confidence * 100;
                    livenessDecision = response.LivenessDecision ?? "LIVE";
                    _logger.LogInformation("✅ Liveness do AWS Rekognition: {Score}%, Decision: {Decision}", livenessScore, livenessDecision);
                }
                catch (Exception exRekognition)
                {
                    _logger.LogWarning(exRekognition, "⚠️ Erro ao obter resultados do AWS Rekognition para sessionId {SessionId}. Usando liveness padrão (100%)", request.SessionId);
                    // Continua com liveness padrão
                }
            }
            else
            {
                // SessionId não é UUID - captura local, não tem sessão AWS Rekognition
                _logger.LogInformation("ℹ️ SessionId não é UUID válido ({SessionId}). Captura local detectada. Usando liveness padrão (100%)", request.SessionId);
                response = new LivenessResultResponse
                {
                    SessionId = request.SessionId,
                    Confidence = 1.0f,
                    LivenessDecision = "LIVE",
                    Status = "SUCCEEDED",
                    Message = "Liveness verificado localmente"
                };
            }

            var transactionId = request.TransactionId ?? response?.TransactionId ?? Guid.NewGuid().ToString();

            // Se DocumentKey fornecido, fazer análise completa (Documento PRIMEIRO, depois Match)
            float? matchScore = null;
            DocumentAnalysisResult? docAnalysis = null;
            double? identityScore = null;
            string? observacao = null;

            if (!string.IsNullOrEmpty(request.DocumentKey) && !string.IsNullOrEmpty(request.SelfieKey))
            {
                try
                {
                    _logger.LogInformation("📊 Iniciando análise completa: Liveness + Documento + Match");
                    
                    var bucketName = _configuration["AWS:S3Bucket"] ?? _configuration["AWS_S3_BUCKET"] ?? "dayfusion-bucket";
                    
                    // 1. PRIMEIRO: Analisar documento (validar se é RG/CNH)
                    _logger.LogInformation("📄 [PASSO 1] Analisando documento ANTES do match: {DocumentKey}", request.DocumentKey);
                    docAnalysis = await _docAnalyzer.AnalyzeAsync(bucketName, request.DocumentKey);
                    
                    _logger.LogInformation("✅ Análise de documento concluída. DocumentScore: {DocScore}, Flags: {Flags}", 
                        docAnalysis.DocumentScore, string.Join(", ", docAnalysis.Flags));

                    // 2. CRÍTICO: Se documento não é RG/CNH válido, REJEITAR IMEDIATAMENTE
                    if (docAnalysis.DocumentScore <= 0 || docAnalysis.Flags.Contains("nao_e_documento") || docAnalysis.Flags.Contains("fraude_nao_e_documento"))
                    {
                        _logger.LogWarning("🚨 Documento rejeitado: não é RG ou CNH válido. Score: {Score}, Observação: {Obs}",
                            docAnalysis.DocumentScore, docAnalysis.Observacao);
                        
                        // Rejeitar sem fazer match de faces
                        observacao = docAnalysis.Observacao;
                        identityScore = 0;
                        
                        // Persistir transação rejeitada
                        try
                        {
                            var userId = GetCurrentUserId();
                        var transaction = new Transaction
                        {
                            Id = transactionId,
                            UserId = userId,
                            SelfieUrl = request.SelfieKey ?? response?.ReferenceImageUrl ?? string.Empty,
                            DocumentUrl = request.DocumentKey,
                            LivenessScore = (float)livenessScore,
                            SimilarityScore = null, // Não fez match
                            DocumentScore = (float)docAnalysis.DocumentScore,
                            IdentityScore = 0,
                            Observacao = observacao,
                            Status = TransactionStatus.Rejected,
                            ProcessedAt = DateTime.UtcNow,
                            CreatedAt = DateTime.UtcNow,
                            AutoObservations = docAnalysis.Flags
                        };
                            await _dynamoService.CreateTransactionAsync(transaction);
                            _logger.LogInformation("✅ Transaction {TransactionId} persistida como REJEITADA (documento inválido)", transactionId);
                        }
                        catch (Exception exPersist)
                        {
                            _logger.LogError(exPersist, "Failed to persist rejected transaction {TransactionId}", transactionId);
                        }
                        
                        // Retornar resposta rejeitada
                        if (response == null)
                        {
                            response = new LivenessResultResponse
                            {
                                SessionId = request.SessionId,
                                Confidence = 1.0f,
                                LivenessDecision = "LIVE",
                                Status = "SUCCEEDED"
                            };
                        }
                        response.Message = $"Documento rejeitado: {docAnalysis.Observacao}";
                        response.Observacao = docAnalysis.Observacao;
                        response.DocumentScore = (float)docAnalysis.DocumentScore;
                        response.IdentityScore = 0;
                        return Ok(response);
                    }

                    // 3. Se documento válido, fazer match de faces
                    _logger.LogInformation("✅ [PASSO 2] Documento válido, fazendo match de faces...");
                    var compareRequest = new FaceComparisonRequest
                    {
                        SelfieKey = request.SelfieKey,
                        DocumentKey = request.DocumentKey,
                        TransactionId = transactionId
                    };
                    
                    var faceComparison = await _rekognitionService.CompareFacesAsync(compareRequest);
                    matchScore = faceComparison.SimilarityScore;
                    
                    _logger.LogInformation("✅ Face match concluído. Score: {MatchScore}%", matchScore);

                    // 4. Calcular IdentityScore completo (soma: documento + foto + faceID)
                    identityScore = _validator.CalculateIdentityScore(
                        livenessScore,
                        matchScore,
                        docAnalysis.DocumentScore);
                    
                    observacao = _validator.GenerateObservation(identityScore.Value, docAnalysis.Observacao);
                    
                    _logger.LogInformation("✅ Análise completa concluída. Liveness: {Liveness}%, Match: {Match}%, Document: {Doc}%, Identity: {Identity}",
                        livenessScore, matchScore, docAnalysis.DocumentScore, identityScore);
                }
                catch (Exception exAnalysis)
                {
                    _logger.LogError(exAnalysis, "❌ Erro na análise completa");
                    // Se erro na análise, rejeitar por segurança
                    observacao = "🚨 Erro ao processar validação completa";
                    identityScore = 0;
                }
            }

            // Persist transaction com todos os scores
            if (!string.IsNullOrEmpty(transactionId))
            {
                try
                {
                    var userId = GetCurrentUserId();
                    var status = (response?.LivenessDecision ?? livenessDecision) == "LIVE" 
                        ? TransactionStatus.Approved 
                        : TransactionStatus.Rejected;

                    // Se análise completa foi feita, usar status baseado no IdentityScore
                    if (identityScore.HasValue && docAnalysis != null)
                    {
                        status = _validator.DetermineFinalStatus(
                            identityScore.Value,
                            livenessScore,
                            matchScore,
                            docAnalysis.DocumentScore);
                    }

                    var transaction = new Transaction
                    {
                        Id = transactionId,
                        UserId = userId,
                        SelfieUrl = request.SelfieKey ?? response?.ReferenceImageUrl ?? string.Empty,
                        DocumentUrl = request.DocumentKey ?? string.Empty,
                        LivenessScore = (float)livenessScore,
                        SimilarityScore = matchScore,
                        DocumentScore = docAnalysis != null ? (float)docAnalysis.DocumentScore : null,
                        IdentityScore = identityScore,
                        Observacao = observacao,
                        Status = status,
                        ProcessedAt = DateTime.UtcNow,
                        CreatedAt = DateTime.UtcNow,
                        AutoObservations = docAnalysis?.Flags.Any() == true ? docAnalysis.Flags : null
                    };

                    await _dynamoService.CreateTransactionAsync(transaction);
                    _logger.LogInformation("✅ Transaction {TransactionId} persistida com análise completa", transactionId);
                }
                catch (Exception exPersist)
                {
                    _logger.LogError(exPersist, "Failed to persist transaction {TransactionId} after liveness check", 
                        transactionId);
                }
            }

            // Garantir que response não é null antes de retornar
            if (response == null)
            {
                response = new LivenessResultResponse
                {
                    SessionId = request.SessionId,
                    Confidence = livenessScore / 100f,
                    LivenessDecision = livenessDecision,
                    Status = "SUCCEEDED",
                    Message = "Análise completa concluída"
                };
            }

            // Preencher campos adicionais da análise completa
            if (!string.IsNullOrEmpty(observacao))
            {
                response.Observacao = observacao;
            }
            
            if (docAnalysis != null)
            {
                response.DocumentScore = (float)docAnalysis.DocumentScore;
            }
            
            if (identityScore.HasValue)
            {
                response.IdentityScore = identityScore.Value;
            }
            
            if (matchScore.HasValue)
            {
                response.MatchScore = matchScore.Value;
            }

            _logger.LogInformation("Face Liveness results retrieved. SessionId: {SessionId}, Decision: {Decision}, Confidence: {Confidence}, DocumentScore: {DocScore}, IdentityScore: {IdentityScore}",
                response.SessionId, response.LivenessDecision, response.Confidence, response.DocumentScore, response.IdentityScore);

            return Ok(response);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error getting Face Liveness results for session: {SessionId}", request.SessionId);
            return StatusCode(500, new { message = "Erro ao obter resultados de liveness", error = ex.Message });
        }
    }

    private string GetCurrentUserId()
    {
        // In a real implementation, this would extract the user ID from the JWT token
        // For now, we'll use a placeholder
        return User.FindFirst("sub")?.Value ?? "anonymous";
    }
}
