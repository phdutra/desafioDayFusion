using DayFusion.API.Models;
using DayFusion.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DayFusion.API.Controllers;

/// <summary>
/// Controller para verificação completa com Face Comparison + Anti-Deepfake
/// </summary>
[ApiController]
[Route("api/verification")]
[AllowAnonymous]
public class VerificationController : ControllerBase
{
    private readonly IRekognitionService _rekognitionService;
    private readonly IAntiDeepfakeService _antiDeepfakeService;
    private readonly IDynamoDBService _dynamoService;
    private readonly ILogger<VerificationController> _logger;

    // Thresholds de decisão (configuráveis via appsettings no futuro)
    private const float DEEPFAKE_REVIEW_THRESHOLD = 0.30f;
    private const float DEEPFAKE_REJECT_THRESHOLD = 0.60f;

    public VerificationController(
        IRekognitionService rekognitionService,
        IAntiDeepfakeService antiDeepfakeService,
        IDynamoDBService dynamoService,
        ILogger<VerificationController> logger)
    {
        _rekognitionService = rekognitionService;
        _antiDeepfakeService = antiDeepfakeService;
        _dynamoService = dynamoService;
        _logger = logger;
    }

    /// <summary>
    /// Verificação completa: Face Comparison + Anti-Deepfake (se VideoKey fornecido)
    /// Este endpoint orquestra a análise em 2 camadas para máxima segurança
    /// </summary>
    /// <param name="request">Request com SelfieKey, DocumentKey e opcionalmente VideoKey</param>
    /// <returns>Resultado consolidado com decisão final</returns>
    [HttpPost("verify")]
    public async Task<ActionResult<VerifyWithAntiDeepfakeResponse>> Verify(
        [FromBody] VerifyWithAntiDeepfakeRequest request)
    {
        try
        {
            _logger.LogInformation("🔐 Starting full verification. Transaction: {TransactionId}", request.TransactionId);

            // ========== CAMADA 1: Face Comparison (obrigatória) ==========
            var comparisonRequest = new FaceComparisonRequest
            {
                SelfieKey = request.SelfieKey,
                DocumentKey = request.DocumentKey,
                TransactionId = request.TransactionId
            };

            _logger.LogInformation("👤 Performing face comparison...");
            var comparisonResult = await _rekognitionService.CompareFacesAsync(comparisonRequest);
            var transactionId = comparisonResult.TransactionId;

            _logger.LogInformation("✅ Face comparison completed. Score: {Score}%, Status: {Status}", 
                comparisonResult.SimilarityScore, comparisonResult.Status);

            // ========== CAMADA 2: Anti-Deepfake (opcional, se vídeo fornecido) ==========
            AntiDeepfakeResult? antiDeepfakeResult = null;
            
            if (!string.IsNullOrEmpty(request.VideoKey))
            {
                _logger.LogInformation("📹 Running anti-deepfake analysis on video: {VideoKey}", request.VideoKey);
                
                try
                {
                    antiDeepfakeResult = await _antiDeepfakeService.AnalyzeVideoAsync(request.VideoKey);
                    
                    _logger.LogInformation("✅ Anti-deepfake analysis completed. Score: {Score}, Pattern: {Pattern}, AudioSync: {Sync}",
                        antiDeepfakeResult.DeepfakeScore, antiDeepfakeResult.BlinkPattern, antiDeepfakeResult.AudioSync);
                }
                catch (Exception exAntiDeepfake)
                {
                    _logger.LogError(exAntiDeepfake, "⚠️ Anti-deepfake analysis failed. Continuing with face comparison only.");
                    // Não falha toda a verificação - continua só com face comparison
                }
            }
            else
            {
                _logger.LogInformation("ℹ️ No video provided. Skipping anti-deepfake analysis (face comparison only).");
            }

            // ========== DECISÃO COMBINADA ==========
            var finalStatus = DetermineFinalStatus(
                comparisonResult.SimilarityScore, 
                comparisonResult.Status,
                antiDeepfakeResult?.DeepfakeScore);

            var finalMessage = GetStatusMessage(finalStatus, comparisonResult.SimilarityScore, antiDeepfakeResult?.DeepfakeScore);

            _logger.LogInformation("📊 Final decision: {Status} (Face: {FaceScore}%, Deepfake: {DeepfakeScore})", 
                finalStatus, 
                comparisonResult.SimilarityScore, 
                antiDeepfakeResult?.DeepfakeScore);

            // ========== PERSISTÊNCIA NO DYNAMODB ==========
            try
            {
                var userId = GetCurrentUserId();
                var transaction = new Transaction
                {
                    Id = transactionId,
                    UserId = userId,
                    SelfieUrl = request.SelfieKey,
                    DocumentUrl = request.DocumentKey,
                    SimilarityScore = comparisonResult.SimilarityScore,
                    Status = finalStatus,
                    ProcessedAt = DateTime.UtcNow,
                    CreatedAt = DateTime.UtcNow,
                    
                    // Anti-deepfake fields
                    VideoKey = request.VideoKey,
                    DeepfakeScore = antiDeepfakeResult?.DeepfakeScore,
                    BlinkPattern = antiDeepfakeResult?.BlinkPattern,
                    AudioSync = antiDeepfakeResult?.AudioSync,
                    DetectedArtifacts = antiDeepfakeResult?.DetectedArtifacts,
                    ModelVersion = antiDeepfakeResult?.ModelVersion,
                    VideoExpiresAt = !string.IsNullOrEmpty(request.VideoKey) 
                        ? DateTime.UtcNow.AddHours(1)  // vídeo expira em 1h (lifecycle S3)
                        : null
                };

                await _dynamoService.CreateTransactionAsync(transaction);
                _logger.LogInformation("✅ Transaction saved: {TransactionId}", transactionId);
            }
            catch (Exception exPersist)
            {
                _logger.LogError(exPersist, "⚠️ Failed to persist transaction {TransactionId}. Verification succeeded but not saved.", 
                    transactionId);
                // Não falha a requisição - a verificação foi bem-sucedida
            }

            // ========== RETORNAR RESULTADO ==========
            return Ok(new VerifyWithAntiDeepfakeResponse
            {
                TransactionId = transactionId,
                SimilarityScore = comparisonResult.SimilarityScore,
                Status = finalStatus,
                Message = finalMessage,
                AntiDeepfake = antiDeepfakeResult
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "❌ Error during verification");
            return StatusCode(500, new { error = "Erro durante verificação", message = ex.Message });
        }
    }

    /// <summary>
    /// Determina o status final combinando Face Comparison + Anti-Deepfake
    /// Política: rejeitar se qualquer camada reprovar; revisar se suspeito; aprovar apenas se ambas OK
    /// </summary>
    private TransactionStatus DetermineFinalStatus(
        float similarityScore, 
        TransactionStatus faceStatus,
        float? deepfakeScore)
    {
        // Se comparação facial já reprovou/erro, manter
        if (faceStatus == TransactionStatus.Rejected || faceStatus == TransactionStatus.Error)
        {
            _logger.LogInformation("📋 Face comparison rejected/error. Final status: {Status}", faceStatus);
            return faceStatus;
        }

        // Se não há análise de deepfake, usar status da face
        if (deepfakeScore == null)
        {
            _logger.LogInformation("📋 No anti-deepfake analysis. Using face comparison status: {Status}", faceStatus);
            return faceStatus;
        }

        // Aplicar thresholds de deepfake (política de segurança)
        if (deepfakeScore >= DEEPFAKE_REJECT_THRESHOLD)
        {
            _logger.LogWarning("🚨 REJECTING: Deepfake score too high: {Score} >= {Threshold}", 
                deepfakeScore, DEEPFAKE_REJECT_THRESHOLD);
            return TransactionStatus.Rejected;
        }

        if (deepfakeScore >= DEEPFAKE_REVIEW_THRESHOLD)
        {
            _logger.LogWarning("👀 MANUAL REVIEW required: Deepfake score suspicious: {Score} >= {Threshold}", 
                deepfakeScore, DEEPFAKE_REVIEW_THRESHOLD);
            return TransactionStatus.ManualReview;
        }

        // Deepfake OK (score baixo), retornar status da face
        _logger.LogInformation("✅ Anti-deepfake OK (score: {Score}). Using face comparison status: {Status}", 
            deepfakeScore, faceStatus);
        return faceStatus;
    }

    /// <summary>
    /// Gera mensagem descritiva do status final
    /// </summary>
    private string GetStatusMessage(TransactionStatus status, float faceScore, float? deepfakeScore)
    {
        var dfInfo = deepfakeScore.HasValue 
            ? $" | Deepfake: {deepfakeScore.Value:F2}" 
            : "";
        
        return status switch
        {
            TransactionStatus.Approved => $"✅ Verificação aprovada (Face: {faceScore:F1}%{dfInfo})",
            TransactionStatus.ManualReview => $"👀 Revisão manual necessária (Face: {faceScore:F1}%{dfInfo})",
            TransactionStatus.Rejected => $"❌ Verificação reprovada (Face: {faceScore:F1}%{dfInfo})",
            TransactionStatus.Error => $"⚠️ Erro durante verificação (Face: {faceScore:F1}%{dfInfo})",
            _ => $"🔄 Processando (Face: {faceScore:F1}%{dfInfo})"
        };
    }

    /// <summary>
    /// Extrai UserId do JWT ou retorna "anonymous"
    /// </summary>
    private string GetCurrentUserId()
    {
        return User?.Identity?.Name ?? User?.FindFirst("sub")?.Value ?? "anonymous";
    }
}

