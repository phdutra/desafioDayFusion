using DayFusion.API.Models;
using DayFusion.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DayFusion.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[AllowAnonymous]
public class FaceRecognitionController : ControllerBase
{
    private readonly IRekognitionService _rekognitionService;
    private readonly IDynamoDBService _dynamoService;
    private readonly ILogger<FaceRecognitionController> _logger;

    public FaceRecognitionController(
        IRekognitionService rekognitionService,
        IDynamoDBService dynamoService,
        ILogger<FaceRecognitionController> logger)
    {
        _rekognitionService = rekognitionService;
        _dynamoService = dynamoService;
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
    /// Get Face Liveness 3D session results
    /// </summary>
    [HttpPost("liveness/result")]
    public async Task<ActionResult<LivenessResultResponse>> GetLivenessResult([FromBody] GetLivenessResultRequest request)
    {
        try
        {
            _logger.LogInformation("Getting Face Liveness results for session: {SessionId}", request.SessionId);

            var response = await _rekognitionService.GetFaceLivenessSessionResultsAsync(request);

            // Persist transaction if TransactionId provided
            if (!string.IsNullOrEmpty(response.TransactionId))
            {
                try
                {
                    var userId = GetCurrentUserId();
                    var transaction = new Transaction
                    {
                        Id = response.TransactionId,
                        UserId = userId,
                        Status = response.LivenessDecision == "LIVE" 
                            ? TransactionStatus.Approved 
                            : TransactionStatus.Rejected,
                        ProcessedAt = DateTime.UtcNow,
                        CreatedAt = DateTime.UtcNow
                    };

                    await _dynamoService.CreateTransactionAsync(transaction);
                    _logger.LogInformation("Transaction {TransactionId} persisted with liveness result", response.TransactionId);
                }
                catch (Exception exPersist)
                {
                    _logger.LogError(exPersist, "Failed to persist transaction {TransactionId} after liveness check", 
                        response.TransactionId);
                }
            }

            _logger.LogInformation("Face Liveness results retrieved. SessionId: {SessionId}, Decision: {Decision}, Confidence: {Confidence}",
                response.SessionId, response.LivenessDecision, response.Confidence);

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
