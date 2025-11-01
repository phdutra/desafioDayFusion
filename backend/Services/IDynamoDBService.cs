using DayFusion.API.Models;

namespace DayFusion.API.Services;

public interface IDynamoDBService
{
    Task<Transaction> CreateTransactionAsync(Transaction transaction);
    Task<Transaction?> GetTransactionAsync(string transactionId);
    Task<List<Transaction>> GetTransactionsByUserAsync(string userId, int limit = 50);
    Task<List<Transaction>> GetAllTransactionsAsync(int limit = 50);
    Task<List<Transaction>> GetTransactionsForReviewAsync(int limit = 50);
    Task<Transaction> UpdateTransactionAsync(Transaction transaction);
    Task<bool> DeleteTransactionAsync(string transactionId);
}
