using DayFusion.API.Models;
using DayFusion.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DayFusion.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[AllowAnonymous]
public class TransactionsController : ControllerBase
{
    private readonly IDynamoDBService _dynamoService;
    private readonly ILogger<TransactionsController> _logger;
    public TransactionsController(IDynamoDBService dynamoService, ILogger<TransactionsController> logger)
    {
        _dynamoService = dynamoService;
        _logger = logger;
    }

    /// <summary>
    /// Get all transactions (from DynamoDB)
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<List<Transaction>>> GetUserTransactions([FromQuery] int limit = 50)
    {
        try
        {
            _logger.LogInformation("Fetching all transactions from DynamoDB (limit: {Limit})", limit);
            
            // Buscar todas as transações do DynamoDB
            var transactions = await _dynamoService.GetAllTransactionsAsync(limit);
            
            _logger.LogInformation("Retrieved {Count} transactions from DynamoDB", transactions.Count);
            
            return Ok(transactions);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving transactions from DynamoDB");
            return StatusCode(500, new { message = "Internal server error", error = ex.Message });
        }
    }

    /// <summary>
    /// Get a specific transaction by ID
    /// </summary>
    [HttpGet("{transactionId}")]
    public async Task<ActionResult<Transaction>> GetTransaction(string transactionId)
    {
        try
        {
            var transaction = await _dynamoService.GetTransactionAsync(transactionId);
            if (transaction == null)
            {
                return NotFound();
            }

            // Verify the transaction belongs to the current user
            if (transaction.UserId != GetCurrentUserId())
            {
                return Forbid();
            }

            return Ok(transaction);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving transaction: {TransactionId}", transactionId);
            return StatusCode(500, "Internal server error");
        }
    }

    /// <summary>
    /// Get transactions that require manual review (admin only)
    /// </summary>
    [HttpGet("review")]
    public async Task<ActionResult<List<Transaction>>> GetTransactionsForReview([FromQuery] int limit = 50)
    {
        try
        {
            // In a real implementation, you would check if the user has admin privileges
            var transactions = await _dynamoService.GetTransactionsForReviewAsync(limit);
            return Ok(transactions);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving transactions for review");
            return StatusCode(500, "Internal server error");
        }
    }

    /// <summary>
    /// Update transaction status (for manual review)
    /// </summary>
    [HttpPut("{transactionId}/review")]
    public async Task<ActionResult<Transaction>> ReviewTransaction(string transactionId, [FromBody] ReviewRequest request)
    {
        try
        {
            var transaction = await _dynamoService.GetTransactionAsync(transactionId);
            if (transaction == null)
            {
                return NotFound();
            }

            // Update transaction with review results
            transaction.Status = request.Status;
            transaction.ReviewNotes = request.Notes;
            transaction.ReviewedBy = GetCurrentUserId();
            transaction.ReviewedAt = DateTime.UtcNow;

            if (request.Status == TransactionStatus.Rejected)
            {
                transaction.RejectionReason = request.Notes;
            }

            var updatedTransaction = await _dynamoService.UpdateTransactionAsync(transaction);

            _logger.LogInformation("Transaction {TransactionId} reviewed by {Reviewer}. Status: {Status}", 
                transactionId, GetCurrentUserId(), request.Status);

            return Ok(updatedTransaction);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error reviewing transaction: {TransactionId}", transactionId);
            return StatusCode(500, "Internal server error");
        }
    }

    /// <summary>
    /// Delete a transaction
    /// </summary>
    [HttpDelete("{transactionId}")]
    public async Task<ActionResult> DeleteTransaction(string transactionId)
    {
        try
        {
            var transaction = await _dynamoService.GetTransactionAsync(transactionId);
            if (transaction == null)
            {
                return NotFound();
            }

            // Verify the transaction belongs to the current user
            if (transaction.UserId != GetCurrentUserId())
            {
                return Forbid();
            }

            var success = await _dynamoService.DeleteTransactionAsync(transactionId);
            if (success)
            {
                return NoContent();
            }

            return StatusCode(500, "Failed to delete transaction");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting transaction: {TransactionId}", transactionId);
            return StatusCode(500, "Internal server error");
        }
    }

    /// <summary>
    /// Test endpoint to verify DynamoDB connectivity and create a test transaction
    /// </summary>
    [HttpPost("test")]
    public async Task<ActionResult> TestDynamoDB()
    {
        try
        {
            _logger.LogInformation("Testing DynamoDB connectivity by creating a test transaction");
            
            var testTransaction = new Transaction
            {
                Id = Guid.NewGuid().ToString(),
                UserId = "test-user",
                SelfieUrl = "test/selfie.jpg",
                DocumentUrl = "test/doc.jpg",
                SimilarityScore = 85.5f,
                Status = TransactionStatus.Approved,
                CreatedAt = DateTime.UtcNow,
                ProcessedAt = DateTime.UtcNow
            };

            var created = await _dynamoService.CreateTransactionAsync(testTransaction);
            
            _logger.LogInformation("Test transaction created successfully: {TransactionId}", created.Id);
            
            // Verificar se consegue ler de volta
            var retrieved = await _dynamoService.GetTransactionAsync(created.Id);
            
            return Ok(new { 
                success = true, 
                message = "DynamoDB test successful", 
                transaction = created,
                retrieved = retrieved != null,
                tableName = "dayfusion_transactions"
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "DynamoDB test failed: {ErrorMessage}", ex.Message);
            return StatusCode(500, new { 
                success = false, 
                message = "DynamoDB test failed", 
                error = ex.Message,
                innerException = ex.InnerException?.Message,
                stackTrace = ex.StackTrace 
            });
        }
    }

    /// <summary>
    /// Check DynamoDB connection status
    /// </summary>
    [HttpGet("health")]
    public async Task<ActionResult> CheckDynamoDBHealth()
    {
        try
        {
            // Tenta buscar transações para verificar conexão
            var transactions = await _dynamoService.GetAllTransactionsAsync(1);
            
            return Ok(new { 
                status = "healthy",
                message = "DynamoDB connection OK",
                tableName = "dayfusion_transactions",
                existingTransactions = transactions.Count
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { 
                status = "unhealthy",
                message = "DynamoDB connection failed",
                error = ex.Message,
                innerException = ex.InnerException?.Message
            });
        }
    }

    private string GetCurrentUserId()
    {
        // In a real implementation, this would extract the user ID from the JWT token
        return User.FindFirst("sub")?.Value ?? "anonymous";
    }
}
