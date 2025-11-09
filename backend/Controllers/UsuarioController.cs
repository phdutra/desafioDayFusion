using System.Linq;
using System.Threading;
using DayFusion.API.Models;
using DayFusion.API.Services;
using Microsoft.AspNetCore.Mvc;

namespace DayFusion.API.Controllers;

[ApiController]
[Route("api/usuario")]
public class UsuarioController : ControllerBase
{
    private readonly IUserProfileService _userProfileService;
    private readonly ILogger<UsuarioController> _logger;

    public UsuarioController(
        IUserProfileService userProfileService,
        ILogger<UsuarioController> logger)
    {
        _userProfileService = userProfileService;
        _logger = logger;
    }

    [HttpGet("{cpf}")]
    public async Task<ActionResult<CpfLookupResponse>> GetByCpfAsync(string cpf, CancellationToken cancellationToken)
    {
        var sanitizedCpf = SanitizeCpf(cpf);
        if (string.IsNullOrEmpty(sanitizedCpf))
        {
            return BadRequest("CPF inválido. Informe 11 dígitos.");
        }

        try
        {
            var user = await _userProfileService.GetByCpfAsync(sanitizedCpf, cancellationToken);

            if (user is null)
            {
                return Ok(new CpfLookupResponse
                {
                    Cpf = sanitizedCpf,
                    Exists = false,
                    HasFaceId = false
                });
            }

            var response = new CpfLookupResponse
            {
                Cpf = user.Cpf,
                Exists = true,
                HasFaceId = user.HasFaceId,
                Name = user.Name,
                FaceId = user.FaceId,
                FaceImageUrl = user.FaceImageUrl,
                FaceImageKey = user.FaceImageKey
            };

            return Ok(response);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Erro ao buscar CPF {Cpf}", sanitizedCpf);
            return StatusCode(500, new { message = "Erro ao consultar usuário.", error = ex.Message });
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

