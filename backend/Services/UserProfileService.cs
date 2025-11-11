using System;
using System.Collections.Generic;
using Amazon.DynamoDBv2.DataModel;
using Amazon.DynamoDBv2.DocumentModel;
using Amazon.DynamoDBv2.Model;
using System.Linq;
using System.Threading;
using DayFusion.API.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace DayFusion.API.Services;

public class UserProfileService : IUserProfileService
{
    private readonly IDynamoDBContext _context;
    private readonly ILogger<UserProfileService> _logger;
    private readonly string _bucketName;

    public UserProfileService(
        IDynamoDBContext context,
        IConfiguration configuration,
        ILogger<UserProfileService> logger)
    {
        _context = context;
        _logger = logger;
        _bucketName = configuration["AWS:S3Bucket"] ?? configuration["AWS_S3_BUCKET"]
            ?? throw new ArgumentNullException("AWS:S3Bucket", "Configure 'AWS:S3Bucket' em appsettings ou 'AWS_S3_BUCKET' como variável de ambiente.");
    }

    public async Task<UserProfile?> GetByCpfAsync(string cpf, CancellationToken cancellationToken = default)
    {
        var sanitizedCpf = SanitizeCpf(cpf);
        if (string.IsNullOrEmpty(sanitizedCpf))
        {
            return null;
        }

        _logger.LogInformation("Buscando usuário por CPF {Cpf}", sanitizedCpf);

        try
        {
            return await _context.LoadAsync<UserProfile>(sanitizedCpf, cancellationToken);
        }
        catch (ResourceNotFoundException ex)
        {
            _logger.LogWarning(ex, "Tabela DynamoDB não encontrada ao buscar CPF {Cpf}. Retornando nulo.", sanitizedCpf);
            return null;
        }
    }

    public async Task<UserProfile?> GetByFaceIdAsync(string faceId, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(faceId))
        {
            return null;
        }

        var conditions = new List<ScanCondition>
        {
            new(nameof(UserProfile.FaceId), ScanOperator.Equal, faceId)
        };

        try
        {
            var search = _context.ScanAsync<UserProfile>(conditions);
            while (!search.IsDone)
            {
                var batch = await search.GetNextSetAsync(cancellationToken);
                var user = batch.FirstOrDefault(u => string.Equals(u.FaceId, faceId, StringComparison.Ordinal));
                if (user != null)
                {
                    _logger.LogInformation("Usuário encontrado por FaceId {FaceId}: CPF {Cpf}", faceId, user.Cpf);
                    return user;
                }
            }
        }
        catch (ResourceNotFoundException ex)
        {
            _logger.LogWarning(ex, "Tabela DynamoDB não encontrada ao buscar FaceId {FaceId}.", faceId);
            return null;
        }

        _logger.LogWarning("Nenhum usuário encontrado para FaceId {FaceId}", faceId);
        return null;
    }

    public async Task<UserProfile> UpsertAsync(UserProfile user, CancellationToken cancellationToken = default)
    {
        user.Cpf = SanitizeCpf(user.Cpf);
        if (string.IsNullOrEmpty(user.Cpf))
        {
            throw new ArgumentException("CPF inválido.", nameof(user.Cpf));
        }

        UserProfile? existing = null;
        try
        {
            existing = await _context.LoadAsync<UserProfile>(user.Cpf, cancellationToken);
        }
        catch (ResourceNotFoundException ex)
        {
            _logger.LogWarning(ex, "Tabela DynamoDB não encontrada ao carregar CPF {Cpf}. Será criada ao salvar.", user.Cpf);
        }

        var now = DateTime.UtcNow;

        if (existing is null)
        {
            user.CreatedAt = now;
            user.UpdatedAt = now;
            await SaveAsyncSafe(user, cancellationToken);
            _logger.LogInformation("Criado novo usuário {Cpf} no DynamoDB", user.Cpf);
            return user;
        }

        existing.Name = user.Name;
        existing.FaceId = user.FaceId ?? existing.FaceId;
        existing.FaceImageKey = user.FaceImageKey ?? existing.FaceImageKey;
        existing.FaceImageUrl = user.FaceImageUrl ?? existing.FaceImageUrl;
        existing.UpdatedAt = now;

        await SaveAsyncSafe(existing, cancellationToken);
        _logger.LogInformation("Atualizado usuário existente {Cpf}", existing.Cpf);
        return existing;
    }

    public async Task<UserProfile> UpdateFaceDataAsync(string cpf, string name, string faceId, string imageKey, CancellationToken cancellationToken = default)
    {
        var sanitizedCpf = SanitizeCpf(cpf);
        if (string.IsNullOrEmpty(sanitizedCpf))
        {
            throw new ArgumentException("CPF inválido.", nameof(cpf));
        }

        UserProfile? user = null;
        bool isNewUser = false;
        
        try
        {
            user = await _context.LoadAsync<UserProfile>(sanitizedCpf, cancellationToken);
        }
        catch (ResourceNotFoundException ex)
        {
            _logger.LogWarning(ex, "Tabela DynamoDB não encontrada ao atualizar dados faciais do CPF {Cpf}. Um novo registro será preparado.", sanitizedCpf);
        }

        if (user == null)
        {
            isNewUser = true;
            user = new UserProfile
            {
                Cpf = sanitizedCpf,
                Name = name,
                CreatedAt = DateTime.UtcNow
            };
        }

        user.Name = name;
        user.FaceId = faceId;
        user.FaceImageKey = imageKey;
        user.FaceImageUrl = $"s3://{_bucketName}/{imageKey}";
        user.UpdatedAt = DateTime.UtcNow;

        // Configuração automática: CPF master é sempre Admin e aprovado
        if (sanitizedCpf == "22710105861")
        {
            user.Role = "Admin";
            user.IsApproved = true;
            _logger.LogInformation("🔐 CPF Master {Cpf} configurado como Admin e aprovado automaticamente", sanitizedCpf);
        }
        // Se for o primeiro usuário do sistema, torna Admin automaticamente
        else if (isNewUser)
        {
            var allUsers = await GetAllUsersAsync(cancellationToken);
            if (allUsers.Count == 0)
            {
                user.Role = "Admin";
                user.IsApproved = true;
                _logger.LogInformation("🔐 Primeiro usuário do sistema {Cpf} configurado como Admin automaticamente", sanitizedCpf);
            }
        }

        await SaveAsyncSafe(user, cancellationToken);
        _logger.LogInformation("Atualizados dados faciais para CPF {Cpf} (Role: {Role}, IsApproved: {IsApproved})", 
            sanitizedCpf, user.Role, user.IsApproved);
        return user;
    }

    public async Task<UserProfile?> UpdateLastLoginAsync(string cpf, DateTime loginDateUtc, CancellationToken cancellationToken = default)
    {
        var user = await GetByCpfAsync(cpf, cancellationToken);
        if (user is null)
        {
            return null;
        }

        user.LastLoginAt = loginDateUtc;
        user.UpdatedAt = loginDateUtc;
        await SaveAsyncSafe(user, cancellationToken);
        _logger.LogInformation("Atualizado LastLoginAt para CPF {Cpf}", user.Cpf);
        return user;
    }

    public async Task<List<UserProfile>> GetAllUsersAsync(CancellationToken cancellationToken = default)
    {
        var users = new List<UserProfile>();
        
        try
        {
            var search = _context.ScanAsync<UserProfile>(new List<ScanCondition>());
            
            while (!search.IsDone)
            {
                var batch = await search.GetNextSetAsync(cancellationToken);
                users.AddRange(batch);
            }
            
            _logger.LogInformation("Listados {Count} usuários do sistema", users.Count);
        }
        catch (ResourceNotFoundException ex)
        {
            _logger.LogWarning(ex, "Tabela DynamoDB não encontrada ao listar usuários.");
        }
        
        return users;
    }

    public async Task<UserProfile?> UpdateApprovalStatusAsync(string cpf, bool isApproved, CancellationToken cancellationToken = default)
    {
        var user = await GetByCpfAsync(cpf, cancellationToken);
        if (user is null)
        {
            return null;
        }

        user.IsApproved = isApproved;
        user.UpdatedAt = DateTime.UtcNow;
        await SaveAsyncSafe(user, cancellationToken);
        
        var status = isApproved ? "aprovado" : "rejeitado";
        _logger.LogInformation("Usuário {Cpf} foi {Status}", user.Cpf, status);
        return user;
    }

    public async Task<UserProfile?> UpdateRoleAsync(string cpf, string role, CancellationToken cancellationToken = default)
    {
        var user = await GetByCpfAsync(cpf, cancellationToken);
        if (user is null)
        {
            return null;
        }

        user.Role = role;
        user.UpdatedAt = DateTime.UtcNow;
        await SaveAsyncSafe(user, cancellationToken);
        
        _logger.LogInformation("Role do usuário {Cpf} atualizada para {Role}", user.Cpf, role);
        return user;
    }

    public async Task<bool> DeleteUserAsync(string cpf, CancellationToken cancellationToken = default)
    {
        var candidates = new List<string>();
        var sanitizedCpf = SanitizeCpf(cpf);

        if (!string.IsNullOrEmpty(sanitizedCpf))
        {
            candidates.Add(sanitizedCpf);
        }

        if (!string.IsNullOrWhiteSpace(cpf) && !candidates.Contains(cpf))
        {
            candidates.Add(cpf);
        }

        foreach (var candidate in candidates)
        {
            try
            {
                var existing = await _context.LoadAsync<UserProfile>(candidate, cancellationToken);
                if (existing is null)
                {
                    continue;
                }

                await _context.DeleteAsync(existing, cancellationToken);
                _logger.LogInformation("Usuário {Cpf} removido do DynamoDB", candidate);
                return true;
            }
            catch (ResourceNotFoundException ex)
            {
                _logger.LogWarning(ex, "Tabela DynamoDB não encontrada ao excluir usuário {Cpf}.", candidate);
                return false;
            }
        }

        _logger.LogWarning("Tentativa de excluir usuário não localizado para CPF {Cpf}", cpf);
        return false;
    }

    private async Task SaveAsyncSafe(UserProfile user, CancellationToken cancellationToken)
    {
        try
        {
            await _context.SaveAsync(user, cancellationToken);
        }
        catch (ResourceNotFoundException ex)
        {
            _logger.LogWarning(ex, "Tabela DynamoDB não encontrada ao salvar CPF {Cpf}.", user.Cpf);
        }
    }

    private static string SanitizeCpf(string? cpf)
    {
        if (string.IsNullOrWhiteSpace(cpf))
        {
            return string.Empty;
        }

        var digits = new string(cpf.Where(char.IsDigit).ToArray());
        return digits.Length == 11 ? digits : string.Empty;
    }
}

