using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.DataModel;
using Amazon.DynamoDBv2.DocumentModel;
using DayFusion.API.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace DayFusion.API.Services;

public class DynamoDBService : IDynamoDBService
{
    private readonly IDynamoDBContext _dynamoContext;
    private readonly IConfiguration _configuration;
    private readonly ILogger<DynamoDBService> _logger;
    private readonly string _tableName;

    public DynamoDBService(
        IDynamoDBContext dynamoContext,
        IConfiguration configuration,
        ILogger<DynamoDBService> logger)
    {
        _dynamoContext = dynamoContext;
        _configuration = configuration;
        _logger = logger;
        var prefix = _configuration["DynamoDB:TablePrefix"] ?? _configuration["DYNAMODB_TABLE_PREFIX"] ?? "dayfusion";
        _tableName = prefix + "_transactions";
    }

    public async Task<Transaction> CreateTransactionAsync(Transaction transaction)
    {
        try
        {
            _logger.LogInformation("Attempting to save transaction to DynamoDB. Table: {TableName}, ID: {TransactionId}, UserId: {UserId}", 
                _tableName, transaction.Id, transaction.UserId);
            
            await _dynamoContext.SaveAsync(transaction);
            
            _logger.LogInformation("Successfully created transaction with ID: {TransactionId} in table {TableName}", 
                transaction.Id, _tableName);
            
            return transaction;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error creating transaction with ID: {TransactionId} in table {TableName}. Error: {ErrorMessage}", 
                transaction.Id, _tableName, ex.Message);
            _logger.LogError("Stack trace: {StackTrace}", ex.StackTrace);
            throw;
        }
    }

    public async Task<Transaction?> GetTransactionAsync(string transactionId)
    {
        try
        {
            var transaction = await _dynamoContext.LoadAsync<Transaction>(transactionId);
            _logger.LogInformation("Retrieved transaction with ID: {TransactionId}", transactionId);
            return transaction;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving transaction with ID: {TransactionId}", transactionId);
            return null;
        }
    }

    public async Task<List<Transaction>> GetTransactionsByUserAsync(string userId, int limit = 50)
    {
        try
        {
            var conditions = new List<ScanCondition>
            {
                new("UserId", ScanOperator.Equal, userId)
            };

            var search = _dynamoContext.ScanAsync<Transaction>(conditions);
            var transactions = new List<Transaction>();

            do
            {
                var batch = await search.GetNextSetAsync();
                transactions.AddRange(batch);
            } while (!search.IsDone && transactions.Count < limit);

            var result = transactions
                .OrderByDescending(t => t.CreatedAt)
                .Take(limit)
                .ToList();

            _logger.LogInformation("Retrieved {Count} transactions for user: {UserId}", result.Count, userId);
            return result;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving transactions for user: {UserId}", userId);
            return new List<Transaction>();
        }
    }

    public async Task<List<Transaction>> GetAllTransactionsAsync(int limit = 50)
    {
        try
        {
            _logger.LogInformation("Starting scan of DynamoDB table {TableName} to retrieve all transactions", _tableName);
            
            var search = _dynamoContext.ScanAsync<Transaction>(new List<ScanCondition>());
            var transactions = new List<Transaction>();

            do
            {
                var batch = await search.GetNextSetAsync();
                _logger.LogInformation("Retrieved batch of {BatchCount} transactions from DynamoDB", batch.Count);
                transactions.AddRange(batch);
            } while (!search.IsDone && transactions.Count < limit);

            var result = transactions
                .OrderByDescending(t => t.CreatedAt)
                .Take(limit)
                .ToList();

            _logger.LogInformation("Retrieved total of {Count} transactions from DynamoDB table {TableName}", 
                result.Count, _tableName);
            
            return result;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving all transactions from DynamoDB table {TableName}. Error: {ErrorMessage}", 
                _tableName, ex.Message);
            _logger.LogError("Stack trace: {StackTrace}", ex.StackTrace);
            return new List<Transaction>();
        }
    }

    public async Task<List<Transaction>> GetTransactionsForReviewAsync(int limit = 50)
    {
        try
        {
            var conditions = new List<ScanCondition>
            {
                new("Status", ScanOperator.Equal, TransactionStatus.ManualReview)
            };

            var search = _dynamoContext.ScanAsync<Transaction>(conditions);
            var transactions = new List<Transaction>();

            do
            {
                var batch = await search.GetNextSetAsync();
                transactions.AddRange(batch);
            } while (!search.IsDone && transactions.Count < limit);

            var result = transactions
                .OrderBy(t => t.CreatedAt)
                .Take(limit)
                .ToList();

            _logger.LogInformation("Retrieved {Count} transactions for review", result.Count);
            return result;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving transactions for review");
            return new List<Transaction>();
        }
    }

    public async Task<Transaction> UpdateTransactionAsync(Transaction transaction)
    {
        try
        {
            await _dynamoContext.SaveAsync(transaction);
            _logger.LogInformation("Updated transaction with ID: {TransactionId}", transaction.Id);
            return transaction;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error updating transaction with ID: {TransactionId}", transaction.Id);
            throw;
        }
    }

    public async Task<bool> DeleteTransactionAsync(string transactionId)
    {
        try
        {
            await _dynamoContext.DeleteAsync<Transaction>(transactionId);
            _logger.LogInformation("Deleted transaction with ID: {TransactionId}", transactionId);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting transaction with ID: {TransactionId}", transactionId);
            return false;
        }
    }
}
