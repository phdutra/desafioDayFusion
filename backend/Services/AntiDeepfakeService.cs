using Amazon.Lambda;
using Amazon.Lambda.Model;
using DayFusion.API.Models;
using System.Text.Json;

namespace DayFusion.API.Services;

/// <summary>
/// Implementação do serviço anti-deepfake usando AWS Lambda
/// </summary>
public class AntiDeepfakeService : IAntiDeepfakeService
{
    private readonly IAmazonLambda _lambdaClient;
    private readonly IConfiguration _configuration;
    private readonly ILogger<AntiDeepfakeService> _logger;
    private readonly string _lambdaFunctionName;
    
    // Thresholds configuráveis
    private const float REVIEW_THRESHOLD = 0.30f;
    private const float REJECT_THRESHOLD = 0.60f;

    public AntiDeepfakeService(
        IAmazonLambda lambdaClient,
        IConfiguration configuration,
        ILogger<AntiDeepfakeService> logger)
    {
        _lambdaClient = lambdaClient;
        _configuration = configuration;
        _logger = logger;
        
        // Nome da função Lambda (configurável)
        _lambdaFunctionName = _configuration["AWS:AntiDeepfakeLambda"] 
            ?? _configuration["AWS_ANTI_DEEPFAKE_LAMBDA"]
            ?? "dayfusion-anti-deepfake";
        
        _logger.LogInformation("🔍 AntiDeepfakeService initialized. Lambda: {LambdaName}", _lambdaFunctionName);
    }

    public async Task<AntiDeepfakeResult> AnalyzeVideoAsync(string videoKey)
    {
        try
        {
            _logger.LogInformation("🔍 Starting anti-deepfake analysis for video: {VideoKey}", videoKey);

            // Payload para Lambda
            var payload = new { s3Key = videoKey };
            var payloadJson = JsonSerializer.Serialize(payload);

            var request = new InvokeRequest
            {
                FunctionName = _lambdaFunctionName,
                Payload = payloadJson
            };

            _logger.LogInformation("📤 Invoking Lambda function: {FunctionName}", _lambdaFunctionName);
            
            var response = await _lambdaClient.InvokeAsync(request);
            
            // Verificar status da invocação
            if (response.StatusCode != 200)
            {
                _logger.LogError("❌ Lambda invocation failed. StatusCode: {StatusCode}", response.StatusCode);
                return GetErrorResult("Lambda invocation failed");
            }
            
            using var reader = new StreamReader(response.Payload);
            var resultJson = await reader.ReadToEndAsync();
            
            _logger.LogInformation("📊 Lambda response: {Response}", resultJson);

            var result = JsonSerializer.Deserialize<AntiDeepfakeResult>(resultJson, 
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

            if (result == null)
            {
                throw new InvalidOperationException("Lambda retornou resultado nulo");
            }

            _logger.LogInformation("✅ Anti-deepfake analysis completed. Score: {Score}, Pattern: {Pattern}, AudioSync: {Sync}", 
                result.DeepfakeScore, result.BlinkPattern, result.AudioSync);

            // Log de warning se score alto
            if (result.DeepfakeScore >= REJECT_THRESHOLD)
            {
                _logger.LogWarning("⚠️ HIGH DEEPFAKE SCORE detected: {Score} >= {Threshold}", 
                    result.DeepfakeScore, REJECT_THRESHOLD);
            }
            else if (result.DeepfakeScore >= REVIEW_THRESHOLD)
            {
                _logger.LogWarning("👀 MEDIUM DEEPFAKE SCORE detected: {Score} >= {Threshold}", 
                    result.DeepfakeScore, REVIEW_THRESHOLD);
            }

            return result;
        }
        catch (AmazonLambdaException ex)
        {
            _logger.LogError(ex, "❌ AWS Lambda error during anti-deepfake analysis. ErrorCode: {ErrorCode}, Message: {Message}", 
                ex.ErrorCode, ex.Message);
            return GetErrorResult($"Lambda error: {ex.Message}");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "❌ Unexpected error during anti-deepfake analysis for video: {VideoKey}", videoKey);
            return GetErrorResult($"Analysis error: {ex.Message}");
        }
    }

    /// <summary>
    /// Retorna resultado neutro em caso de erro (não bloquear transação)
    /// </summary>
    private AntiDeepfakeResult GetErrorResult(string errorMessage)
    {
        _logger.LogWarning("⚠️ Returning neutral score due to error: {Error}", errorMessage);
        
        return new AntiDeepfakeResult
        {
            DeepfakeScore = 0.5f,  // score neutro (neither safe nor dangerous)
            BlinkPattern = "error",
            AudioSync = "error",
            DetectedArtifacts = new List<string> { "analysis_error" },
            ModelVersion = "error"
        };
    }
}

