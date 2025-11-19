using DayFusion.API.Models;

namespace DayFusion.API.Services;

public interface ILogsService
{
    Task<LogsResponse> GetLogsAsync(GetLogsRequest request);
}

