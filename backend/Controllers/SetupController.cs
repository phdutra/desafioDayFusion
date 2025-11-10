using DayFusion.API.Services;
using Microsoft.AspNetCore.Mvc;

namespace DayFusion.API.Controllers;

/// <summary>
/// Controller temporário para configuração inicial do sistema
/// IMPORTANTE: Remover ou proteger em produção!
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class SetupController : ControllerBase
{
    private readonly ILogger<SetupController> _logger;
    private readonly IUserProfileService _userProfileService;

    public SetupController(
        ILogger<SetupController> logger,
        IUserProfileService userProfileService)
    {
        _logger = logger;
        _userProfileService = userProfileService;
    }

    /// <summary>
    /// Transforma um usuário em Admin e aprova automaticamente
    /// TEMPORÁRIO - Apenas para configuração inicial!
    /// </summary>
    [HttpPost("make-admin/{cpf}")]
    public async Task<IActionResult> MakeAdminAsync(string cpf, CancellationToken cancellationToken)
    {
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
                return NotFound(new { message = "Usuário não encontrado. Faça o cadastro facial primeiro." });
            }

            // Atualiza para Admin e aprova
            await _userProfileService.UpdateRoleAsync(sanitizedCpf, "Admin", cancellationToken);
            await _userProfileService.UpdateApprovalStatusAsync(sanitizedCpf, true, cancellationToken);

            _logger.LogWarning("SETUP: Usuário {Cpf} foi transformado em Admin", sanitizedCpf);
            
            return Ok(new { 
                message = $"Usuário {user.Name} ({sanitizedCpf}) agora é Admin e está aprovado!",
                cpf = sanitizedCpf,
                name = user.Name,
                role = "Admin",
                isApproved = true,
                warning = "IMPORTANTE: Faça logout e login novamente para as mudanças terem efeito!"
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Erro ao transformar usuário em Admin");
            return StatusCode(500, new { message = "Erro ao processar solicitação.", error = ex.Message });
        }
    }

    /// <summary>
    /// Lista informações de um usuário (para debug)
    /// </summary>
    [HttpGet("user-info/{cpf}")]
    public async Task<IActionResult> GetUserInfoAsync(string cpf, CancellationToken cancellationToken)
    {
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

            return Ok(new { 
                cpf = user.Cpf,
                name = user.Name,
                role = user.Role,
                isApproved = user.IsApproved,
                hasFaceId = user.HasFaceId,
                createdAt = user.CreatedAt,
                lastLoginAt = user.LastLoginAt
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Erro ao obter informações do usuário");
            return StatusCode(500, new { message = "Erro ao processar solicitação.", error = ex.Message });
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

