using DayFusion.API.Models;
using DayFusion.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DayFusion.API.Controllers;

[ApiController]
[Route("api/logs")]
[Authorize]
public class LogsController : ControllerBase
{
    private readonly ILogsService _logsService;
    private readonly ILogger<LogsController> _logger;

    public LogsController(ILogsService logsService, ILogger<LogsController> logger)
    {
        _logsService = logsService;
        _logger = logger;
    }

    /// <summary>
    /// Busca logs do CloudWatch
    /// </summary>
    [HttpPost("search")]
    public async Task<ActionResult<LogsResponse>> GetLogs([FromBody] GetLogsRequest request)
    {
        try
        {
            var response = await _logsService.GetLogsAsync(request);
            return Ok(response);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Erro ao buscar logs");
            return StatusCode(500, new { message = "Erro ao buscar logs", error = ex.Message });
        }
    }

    /// <summary>
    /// Busca logs recentes (últimas 24 horas)
    /// </summary>
    [HttpGet("recent")]
    public async Task<ActionResult<LogsResponse>> GetRecentLogs([FromQuery] string? filter = null, [FromQuery] int limit = 100)
    {
        try
        {
            var request = new GetLogsRequest
            {
                StartTime = DateTime.UtcNow.AddHours(-24),
                EndTime = DateTime.UtcNow,
                FilterPattern = filter,
                Limit = limit
            };

            var response = await _logsService.GetLogsAsync(request);
            return Ok(response);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Erro ao buscar logs recentes");
            return StatusCode(500, new { message = "Erro ao buscar logs", error = ex.Message });
        }
    }
}

