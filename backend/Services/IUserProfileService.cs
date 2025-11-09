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
}

