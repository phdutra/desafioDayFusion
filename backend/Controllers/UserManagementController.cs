using DayFusion.API.Models;
using DayFusion.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DayFusion.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = "Admin")] // Apenas Admin pode acessar
public class UserManagementController : ControllerBase
{
    private readonly ILogger<UserManagementController> _logger;
    private readonly IUserProfileService _userProfileService;

    public UserManagementController(
        ILogger<UserManagementController> logger,
        IUserProfileService userProfileService)
    {
        _logger = logger;
        _userProfileService = userProfileService;
    }

    /// <summary>
    /// Lista todos os usuários cadastrados (apenas Admin)
    /// </summary>
    [HttpGet("users")]
    public async Task<ActionResult<IEnumerable<UserManagementDto>>> GetAllUsersAsync(CancellationToken cancellationToken)
    {
        try
        {
            var users = await _userProfileService.GetAllUsersAsync(cancellationToken);
            
            var usersDto = users.Select(u => new UserManagementDto
            {
                Cpf = u.Cpf,
                Name = u.Name,
                Role = u.Role,
                IsApproved = u.IsApproved,
                HasFaceId = u.HasFaceId,
                CreatedAt = u.CreatedAt,
                LastLoginAt = u.LastLoginAt
            }).ToList();

            _logger.LogInformation("Admin consultou lista de {Count} usuários", usersDto.Count);
            return Ok(usersDto);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Erro ao listar usuários");
            return StatusCode(500, new { message = "Erro ao listar usuários.", error = ex.Message });
        }
    }

    /// <summary>
    /// Lista apenas usuários pendentes de aprovação (apenas Admin)
    /// </summary>
    [HttpGet("users/pending")]
    public async Task<ActionResult<IEnumerable<UserManagementDto>>> GetPendingUsersAsync(CancellationToken cancellationToken)
    {
        try
        {
            var users = await _userProfileService.GetAllUsersAsync(cancellationToken);
            
            var pendingUsers = users
                .Where(u => !u.IsApproved)
                .Select(u => new UserManagementDto
                {
                    Cpf = u.Cpf,
                    Name = u.Name,
                    Role = u.Role,
                    IsApproved = u.IsApproved,
                    HasFaceId = u.HasFaceId,
                    CreatedAt = u.CreatedAt,
                    LastLoginAt = u.LastLoginAt
                })
                .ToList();

            _logger.LogInformation("Admin consultou {Count} usuários pendentes", pendingUsers.Count);
            return Ok(pendingUsers);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Erro ao listar usuários pendentes");
            return StatusCode(500, new { message = "Erro ao listar usuários pendentes.", error = ex.Message });
        }
    }

    /// <summary>
    /// Aprova ou rejeita um usuário (apenas Admin)
    /// </summary>
    [HttpPut("users/{cpf}/approve")]
    public async Task<IActionResult> ApproveUserAsync(string cpf, [FromBody] ApproveUserRequest request, CancellationToken cancellationToken)
    {
        if (cpf != request.Cpf)
        {
            return BadRequest("CPF na URL não corresponde ao CPF no body");
        }

        try
        {
            var sanitizedCpf = SanitizeCpf(cpf);
            if (string.IsNullOrEmpty(sanitizedCpf))
            {
                return BadRequest("CPF inválido. Informe 11 dígitos.");
            }

            var user = await _userProfileService.GetByCpfAsync(sanitizedCpf, cancellationToken);
            if (user == null)
            {
                return NotFound(new { message = "Usuário não encontrado." });
            }

            await _userProfileService.UpdateApprovalStatusAsync(sanitizedCpf, request.Approve, cancellationToken);

            var action = request.Approve ? "aprovado" : "rejeitado";
            _logger.LogInformation("Usuário {Cpf} foi {Action} pelo admin", sanitizedCpf, action);
            
            return Ok(new { message = $"Usuário {action} com sucesso." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Erro ao aprovar/rejeitar usuário {Cpf}", cpf);
            return StatusCode(500, new { message = "Erro ao processar aprovação.", error = ex.Message });
        }
    }

    /// <summary>
    /// Atualiza a role de um usuário (apenas Admin)
    /// </summary>
    [HttpPut("users/{cpf}/role")]
    public async Task<IActionResult> UpdateUserRoleAsync(string cpf, [FromBody] UpdateRoleRequest request, CancellationToken cancellationToken)
    {
        if (cpf != request.Cpf)
        {
            return BadRequest("CPF na URL não corresponde ao CPF no body");
        }

        try
        {
            var sanitizedCpf = SanitizeCpf(cpf);
            if (string.IsNullOrEmpty(sanitizedCpf))
            {
                return BadRequest("CPF inválido. Informe 11 dígitos.");
            }

            var user = await _userProfileService.GetByCpfAsync(sanitizedCpf, cancellationToken);
            if (user == null)
            {
                return NotFound(new { message = "Usuário não encontrado." });
            }

            await _userProfileService.UpdateRoleAsync(sanitizedCpf, request.Role, cancellationToken);

            _logger.LogInformation("Role do usuário {Cpf} atualizada para {Role}", sanitizedCpf, request.Role);
            
            return Ok(new { message = $"Role atualizada para {request.Role} com sucesso." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Erro ao atualizar role do usuário {Cpf}", cpf);
            return StatusCode(500, new { message = "Erro ao atualizar role.", error = ex.Message });
        }
    }

    private static string SanitizeCpf(string cpf)
    {
        if (string.IsNullOrWhiteSpace(cpf))
        {
            return string.Empty;
        }

        var digits = new string(cpf.Where(char.IsDigit).ToArray());
        return digits.Length == 11 ? digits : string.Empty;
    }
}

