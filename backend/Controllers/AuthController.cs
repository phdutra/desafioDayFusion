using DayFusion.API.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DayFusion.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly ILogger<AuthController> _logger;

    public AuthController(ILogger<AuthController> logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// Login endpoint (placeholder - in production, integrate with AWS Cognito)
    /// </summary>
    [HttpPost("login")]
    public ActionResult<AuthResponse> Login([FromBody] AuthRequest request)
    {
        try
        {
            // This is a placeholder implementation
            // In production, you would integrate with AWS Cognito
            if (string.IsNullOrEmpty(request.Username) || string.IsNullOrEmpty(request.Password))
            {
                return BadRequest("Username and password are required");
            }

            // For demo purposes, accept any credentials
            // In production, validate against Cognito
            var response = new AuthResponse
            {
                AccessToken = GenerateJwtToken(request.Username),
                RefreshToken = Guid.NewGuid().ToString(),
                ExpiresAt = DateTime.UtcNow.AddHours(1),
                UserId = Guid.NewGuid().ToString()
            };

            _logger.LogInformation("User {Username} logged in successfully", request.Username);
            return Ok(response);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error during login for user: {Username}", request.Username);
            return StatusCode(500, "Internal server error");
        }
    }

    /// <summary>
    /// Refresh token endpoint
    /// </summary>
    [HttpPost("refresh")]
    public ActionResult<AuthResponse> RefreshToken([FromBody] string refreshToken)
    {
        try
        {
            // This is a placeholder implementation
            // In production, validate the refresh token and generate a new access token
            var response = new AuthResponse
            {
                AccessToken = GenerateJwtToken("refreshed_user"),
                RefreshToken = Guid.NewGuid().ToString(),
                ExpiresAt = DateTime.UtcNow.AddHours(1),
                UserId = Guid.NewGuid().ToString()
            };

            return Ok(response);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error refreshing token");
            return StatusCode(500, "Internal server error");
        }
    }

    /// <summary>
    /// Logout endpoint
    /// </summary>
    [HttpPost("logout")]
    [Authorize]
    public ActionResult Logout()
    {
        try
        {
            // In production, invalidate the token
            _logger.LogInformation("User logged out");
            return Ok(new { message = "Logged out successfully" });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error during logout");
            return StatusCode(500, "Internal server error");
        }
    }

    /// <summary>
    /// Get current user info
    /// </summary>
    [HttpGet("me")]
    [Authorize]
    public ActionResult<object> GetCurrentUser()
    {
        try
        {
            var userId = User.FindFirst("sub")?.Value ?? "anonymous";
            var username = User.FindFirst("username")?.Value ?? "unknown";

            return Ok(new
            {
                UserId = userId,
                Username = username,
                Claims = User.Claims.Select(c => new { c.Type, c.Value }).ToList()
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error getting current user info");
            return StatusCode(500, "Internal server error");
        }
    }

    private static string GenerateJwtToken(string username)
    {
        // This is a placeholder implementation
        // In production, use proper JWT generation with signing keys
        var token = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes($"demo_token_for_{username}_{DateTime.UtcNow.Ticks}"));
        return token;
    }
}
