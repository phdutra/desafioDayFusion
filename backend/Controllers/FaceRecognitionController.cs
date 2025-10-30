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
                var transaction = new Transaction
                {
                    Id = transactionId,
                    UserId = GetCurrentUserId(),
                    SelfieUrl = request.SelfieKey,
                    DocumentUrl = request.DocumentKey,
                    SimilarityScore = response.SimilarityScore,
                    Status = response.Status,
                    ProcessedAt = DateTime.UtcNow
                };

                // Create or update depending on existence
                await _dynamoService.CreateTransactionAsync(transaction);
            }
            catch (Exception exPersist)
            {
                _logger.LogWarning(exPersist, "Face comparison succeeded but failed to persist transaction {TransactionId}", transactionId);
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
    /// </summary>
    [HttpPost("detect/{imageKey}")]
    public async Task<ActionResult<bool>> DetectFaces(string imageKey)
    {
        try
        {
            var hasFaces = await _rekognitionService.DetectFacesAsync(imageKey);
            return Ok(hasFaces);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error detecting faces in image: {ImageKey}", imageKey);
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

    private string GetCurrentUserId()
    {
        // In a real implementation, this would extract the user ID from the JWT token
        // For now, we'll use a placeholder
        return User.FindFirst("sub")?.Value ?? "anonymous";
    }
}
