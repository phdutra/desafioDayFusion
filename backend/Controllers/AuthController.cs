using System.IdentityModel.Tokens.Jwt;
using System.Linq;
using System.Security.Claims;
using System.Text;
using System.Threading;
using DayFusion.API.Models;
using DayFusion.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;

namespace DayFusion.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private const int DefaultSessionMinutes = 30;

    private readonly ILogger<AuthController> _logger;
    private readonly IUserProfileService _userProfileService;
    private readonly IRekognitionService _rekognitionService;
    private readonly IConfiguration _configuration;

    public AuthController(
        ILogger<AuthController> logger,
        IUserProfileService userProfileService,
        IRekognitionService rekognitionService,
        IConfiguration configuration)
    {
        _logger = logger;
        _userProfileService = userProfileService;
        _rekognitionService = rekognitionService;
        _configuration = configuration;
    }

    /// <summary>
    /// Cadastro facial (primeiro acesso).
    /// Fluxo: imagem já validada pelo Liveness, indexação no Rekognition e persistência no DynamoDB.
    /// </summary>
    [HttpPost("cadastro-facial")]
    public async Task<ActionResult<FaceEnrollmentResponse>> RegisterFaceAsync([FromBody] FaceEnrollmentRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var cpf = SanitizeCpf(request.Cpf);
        if (string.IsNullOrEmpty(cpf))
        {
            return BadRequest("CPF inválido. Informe 11 dígitos.");
        }

        try
        {
            var existingUser = await _userProfileService.GetByCpfAsync(cpf, cancellationToken);
            if (existingUser?.HasFaceId == true)
            {
                _logger.LogInformation("CPF {Cpf} já possui FaceId cadastrado. Substituindo face existente.", cpf);
                try
                {
                    await _rekognitionService.DeleteFaceAsync(existingUser.FaceId!, cancellationToken);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Falha ao remover FaceId antigo {FaceId} para CPF {Cpf}. Prosseguindo com novo cadastro.", existingUser.FaceId, cpf);
                }
            }

            var faceId = await _rekognitionService.IndexFaceAsync(request.ImageKey, cpf, cancellationToken);
            if (string.IsNullOrEmpty(faceId))
            {
                return BadRequest("Nenhuma face detectada para cadastro.");
            }

            var updatedUser = await _userProfileService.UpdateFaceDataAsync(cpf, request.Name, faceId, request.ImageKey, cancellationToken);
            var tokens = GenerateTokens(updatedUser);

            var response = new FaceEnrollmentResponse
            {
                Cpf = updatedUser.Cpf,
                Name = updatedUser.Name,
                FaceId = updatedUser.FaceId ?? string.Empty,
                FaceImageUrl = updatedUser.FaceImageUrl ?? string.Empty,
                FaceImageKey = updatedUser.FaceImageKey ?? string.Empty,
                Tokens = tokens
            };

            _logger.LogInformation("Cadastro facial concluído com sucesso para CPF {Cpf}", cpf);
            return Ok(response);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Erro ao cadastrar face para CPF {Cpf}", cpf);
            return StatusCode(500, new { message = "Erro ao cadastrar face.", error = ex.Message });
        }
    }

    /// <summary>
    /// Autenticação facial para login.
    /// Executa SearchFacesByImage e compara com FaceId associado ao CPF.
    /// </summary>
    [HttpPost("validar-face")]
    public async Task<ActionResult<FaceLoginResponse>> ValidateFaceAsync([FromBody] FaceLoginRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var requestedCpf = SanitizeCpf(request.Cpf);

        try
        {
            var cpf = requestedCpf;
            UserProfile? user = null;
            FaceMatchResult? matchResult;

            if (!string.IsNullOrEmpty(cpf))
            {
                user = await _userProfileService.GetByCpfAsync(cpf, cancellationToken);
                if (user is null)
                {
                    _logger.LogWarning("CPF {Cpf} não encontrado para login facial.", cpf);
                    return NotFound(new { message = "CPF não cadastrado. Realize o cadastro facial." });
                }

                if (!user.HasFaceId)
                {
                    return BadRequest(new { message = "CPF sem FaceID. Finalize o cadastro facial." });
                }

                matchResult = await _rekognitionService.SearchFaceByImageAsync(request.ImageKey, user.FaceId, 90f, cancellationToken);
            }
            else
            {
                matchResult = await _rekognitionService.SearchFaceByImageAsync(request.ImageKey, null, 90f, cancellationToken);

                if (matchResult.IsSuccessful && !string.IsNullOrEmpty(matchResult.MatchedFaceId))
                {
                    user = await _userProfileService.GetByFaceIdAsync(matchResult.MatchedFaceId, cancellationToken);
                    if (user != null)
                    {
                        cpf = user.Cpf;
                    }
                }
            }

            if (!matchResult.IsSuccessful)
            {
                _logger.LogWarning("Autenticação facial rejeitada. CPF={Cpf} Similaridade={Similarity:F2}%.", cpf, matchResult.Similarity);

                return Unauthorized(new FaceLoginResponse
                {
                    Success = false,
                    SimilarityScore = matchResult.Similarity,
                    Message = matchResult.Message,
                    Tokens = new AuthResponse()
                });
            }

            if (user is null)
            {
                _logger.LogWarning("Face reconhecida (Similarity={Similarity:F2}%), mas nenhum usuário associado ao FaceId {FaceId}.", matchResult.Similarity, matchResult.MatchedFaceId);
                return NotFound(new { message = "Reconhecimento realizado, porém usuário não localizado. Informe o CPF para continuar." });
            }

            await _userProfileService.UpdateLastLoginAsync(user.Cpf, DateTime.UtcNow, cancellationToken);
            cpf = user.Cpf;
            var tokens = GenerateTokens(user);

            var userData = new { Cpf = user.Cpf, Name = user.Name };
            _logger.LogInformation("=== DADOS DO USUÁRIO: Cpf={Cpf}, Name={Name} ===", userData.Cpf, userData.Name);

            var response = new FaceLoginResponse
            {
                Success = true,
                SimilarityScore = matchResult.Similarity,
                Message = $"Autenticação aprovada com {matchResult.Similarity:F2}% de similaridade.",
                Tokens = tokens,
                User = userData // Adiciona dados do usuário
            };

            _logger.LogInformation("Autenticação facial aprovada para CPF {Cpf} (Similarity={Similarity:F2}%).", cpf, matchResult.Similarity);
            return Ok(response);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Erro durante autenticação facial para CPF {Cpf}", requestedCpf);
            return StatusCode(500, new { message = "Erro ao validar FaceID.", error = ex.Message });
        }
    }

    /// <summary>
    /// Compatibilidade: /api/auth/login aponta para a mesma lógica de validar face.
    /// </summary>
    [HttpPost("login")]
    public Task<ActionResult<FaceLoginResponse>> LoginCompatAsync([FromBody] FaceLoginRequest request, CancellationToken cancellationToken)
    {
        return ValidateFaceAsync(request, cancellationToken);
    }

    /// <summary>
    /// Refresh token (placeholder). Retorna novo JWT com base no CPF enviado.
    /// </summary>
    [HttpPost("refresh")]
    public async Task<ActionResult<AuthResponse>> RefreshTokenAsync([FromBody] RefreshTokenRequest request, CancellationToken cancellationToken)
    {
        var cpf = SanitizeCpf(request.Cpf);
        if (string.IsNullOrEmpty(cpf))
        {
            return BadRequest("CPF inválido. Informe 11 dígitos.");
        }

        try
        {
            var user = await _userProfileService.GetByCpfAsync(cpf, cancellationToken);
            if (user is null || !user.HasFaceId)
            {
                return Unauthorized(new { message = "CPF não autorizado a gerar refresh token." });
            }

            var tokens = GenerateTokens(user);
            return Ok(tokens);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Erro ao renovar tokens para CPF {Cpf}", cpf);
            return StatusCode(500, "Erro interno.");
        }
    }

    /// <summary>
    /// Logout lógico (frontend limpa storage).
    /// </summary>
    [HttpPost("logout")]
    [Authorize]
    public IActionResult Logout()
    {
        _logger.LogInformation("Logout solicitado pelo usuário {User}", User?.Identity?.Name ?? "desconhecido");
        return Ok(new { message = "Logout efetuado." });
    }

    /// <summary>
    /// Retorna informações básicas do usuário autenticado.
    /// </summary>
    [HttpGet("me")]
    [Authorize]
    public async Task<ActionResult<object>> GetCurrentUserAsync(CancellationToken cancellationToken)
    {
        try
        {
            var cpf = User.FindFirstValue("cpf");
            if (string.IsNullOrEmpty(cpf))
            {
                return Unauthorized(new { message = "CPF não presente no token." });
            }

            var user = await _userProfileService.GetByCpfAsync(cpf, cancellationToken);
            var response = new
            {
                Cpf = user?.Cpf ?? cpf,
                Name = user?.Name ?? User.Identity?.Name ?? string.Empty,
                FaceImageKey = user?.FaceImageKey,
                FaceImageUrl = user?.FaceImageUrl,
                HasFaceId = user?.HasFaceId ?? false,
                Claims = User.Claims.Select(c => new { c.Type, c.Value }).ToList()
            };

            if (user is null)
            {
                _logger.LogWarning("Usuário não encontrado no DynamoDB para CPF {Cpf}, retornando somente dados dos claims.", cpf);
            }

            return Ok(response);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Erro ao recuperar usuário atual.");
            return StatusCode(500, new { message = "Erro interno.", error = ex.Message });
        }
    }

    private AuthResponse GenerateTokens(UserProfile user)
    {
        var secret = _configuration["JWT:Secret"] ?? _configuration["JWT_SECRET"];
        if (string.IsNullOrWhiteSpace(secret))
        {
            throw new InvalidOperationException("Configuração JWT secret não encontrada.");
        }

        var issuer = _configuration["JWT:Issuer"] ?? _configuration["JWT_ISSUER"] ?? "dayfusion-api";
        var audience = _configuration["JWT:Audience"] ?? _configuration["JWT_AUDIENCE"] ?? "dayfusion-client";

        var tokenLifetimeMinutes = DefaultSessionMinutes;
        if (int.TryParse(_configuration["JWT:SessionMinutes"], out var configuredLifetime) && configuredLifetime > 0)
        {
            tokenLifetimeMinutes = configuredLifetime;
        }

        var expiresAt = DateTime.UtcNow.AddMinutes(tokenLifetimeMinutes);
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Cpf),
            new("cpf", user.Cpf),
            new(ClaimTypes.Name, user.Name),
            new("faceId", user.FaceId ?? string.Empty)
        };

        var tokenDescriptor = new SecurityTokenDescriptor
        {
            Subject = new ClaimsIdentity(claims),
            Expires = expiresAt,
            Issuer = issuer,
            Audience = audience,
            SigningCredentials = credentials
        };

        var handler = new JwtSecurityTokenHandler();
        var token = handler.CreateToken(tokenDescriptor);
        var serializedToken = handler.WriteToken(token);

        return new AuthResponse
        {
            AccessToken = serializedToken,
            RefreshToken = Guid.NewGuid().ToString("N"),
            ExpiresAt = expiresAt,
            UserId = user.Cpf
        };
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
