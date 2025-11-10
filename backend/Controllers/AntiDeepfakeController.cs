using DayFusion.API.Models;
using DayFusion.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DayFusion.API.Controllers;

[ApiController]
[Route("api/anti-deepfake")]
[AllowAnonymous]
public class AntiDeepfakeController : ControllerBase
{
    private readonly IAntiDeepfakeService _antiDeepfakeService;
    private readonly IDynamoDBService _dynamoService;
    private readonly ILogger<AntiDeepfakeController> _logger;

    public AntiDeepfakeController(
        IAntiDeepfakeService antiDeepfakeService,
        IDynamoDBService dynamoService,
        ILogger<AntiDeepfakeController> logger)
    {
        _antiDeepfakeService = antiDeepfakeService;
        _dynamoService = dynamoService;
        _logger = logger;
    }

    /// <summary>
    /// Analisa vídeo para detectar deepfakes e manipulações
    /// </summary>
    /// <param name="request">Request contendo chave S3 do vídeo e SessionId opcional</param>
    /// <returns>Resultado da análise com score e indicadores</returns>
    [HttpPost("analyze")]
    public async Task<ActionResult<AntiDeepfakeResult>> Analyze([FromBody] AntiDeepfakeAnalysisRequest request)
    {
        try
        {
            _logger.LogInformation("📹 Analyzing video for deepfake: {VideoKey}, Session: {SessionId}", 
                request.VideoKey, request.SessionId);

            // Invocar análise via Lambda
            var result = await _antiDeepfakeService.AnalyzeVideoAsync(request.VideoKey);

            // Tentar persistir no DynamoDB (se SessionId corresponder a uma transaction)
            if (!string.IsNullOrEmpty(request.SessionId))
            {
                try
                {
                    var transaction = await _dynamoService.GetTransactionAsync(request.SessionId);
                    
                    if (transaction != null)
                    {
                        // Atualizar campos anti-deepfake
                        transaction.DeepfakeScore = result.DeepfakeScore;
                        transaction.BlinkPattern = result.BlinkPattern;
                        transaction.AudioSync = result.AudioSync;
                        transaction.DetectedArtifacts = result.DetectedArtifacts;
                        transaction.ModelVersion = result.ModelVersion;
                        transaction.VideoKey = request.VideoKey;
                        transaction.VideoExpiresAt = DateTime.UtcNow.AddHours(1); // expira em 1h
                        
                        await _dynamoService.UpdateTransactionAsync(transaction);
                        
                        _logger.LogInformation("✅ Updated transaction {SessionId} with anti-deepfake results. Score: {Score}", 
                            request.SessionId, result.DeepfakeScore);
                    }
                    else
                    {
                        _logger.LogWarning("⚠️ Transaction {SessionId} not found. Cannot persist anti-deepfake results.", 
                            request.SessionId);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "⚠️ Failed to update transaction {SessionId} with anti-deepfake results", 
                        request.SessionId);
                    // Não falha o request - análise foi bem-sucedida
                }
            }

            // Log de alerta se score alto
            if (result.DeepfakeScore >= 0.60f)
            {
                _logger.LogWarning("🚨 HIGH RISK deepfake detected! VideoKey: {VideoKey}, Score: {Score}", 
                    request.VideoKey, result.DeepfakeScore);
            }
            else if (result.DeepfakeScore >= 0.30f)
            {
                _logger.LogWarning("⚠️ MEDIUM RISK deepfake detected. VideoKey: {VideoKey}, Score: {Score}", 
                    request.VideoKey, result.DeepfakeScore);
            }
            else
            {
                _logger.LogInformation("✅ LOW RISK video. VideoKey: {VideoKey}, Score: {Score}", 
                    request.VideoKey, result.DeepfakeScore);
            }

            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "❌ Error analyzing video for deepfake: {VideoKey}", request.VideoKey);
            return StatusCode(500, new { error = "Erro ao analisar vídeo para deepfake", message = ex.Message });
        }
    }
}

