using System.Threading;
using DayFusion.API.Models;

namespace DayFusion.API.Services;

public interface IUserProfileService
{
    Task<UserProfile?> GetByCpfAsync(string cpf, CancellationToken cancellationToken = default);
    Task<UserProfile?> GetByFaceIdAsync(string faceId, CancellationToken cancellationToken = default);
    Task<UserProfile> UpsertAsync(UserProfile user, CancellationToken cancellationToken = default);
    Task<UserProfile> UpdateFaceDataAsync(string cpf, string name, string faceId, string imageKey, CancellationToken cancellationToken = default);
    Task<UserProfile?> UpdateLastLoginAsync(string cpf, DateTime loginDateUtc, CancellationToken cancellationToken = default);
    
    // Métodos de gerenciamento de usuários
    Task<List<UserProfile>> GetAllUsersAsync(CancellationToken cancellationToken = default);
    Task<UserProfile?> UpdateApprovalStatusAsync(string cpf, bool isApproved, CancellationToken cancellationToken = default);
    Task<UserProfile?> UpdateRoleAsync(string cpf, string role, CancellationToken cancellationToken = default);
    Task<bool> DeleteUserAsync(string cpf, CancellationToken cancellationToken = default);
}

