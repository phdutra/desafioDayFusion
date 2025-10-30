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
    /// Get all transactions for the current user
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<List<Transaction>>> GetUserTransactions([FromQuery] int limit = 50)
    {
        try
        {
            var userId = GetCurrentUserId();
            var transactions = await _dynamoService.GetTransactionsByUserAsync(userId, limit);
            return Ok(transactions);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving transactions for user: {UserId}", GetCurrentUserId());
            return StatusCode(500, "Internal server error");
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

    private string GetCurrentUserId()
    {
        // In a real implementation, this would extract the user ID from the JWT token
        return User.FindFirst("sub")?.Value ?? "anonymous";
    }
}
