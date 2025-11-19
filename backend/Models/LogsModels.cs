using System.ComponentModel.DataAnnotations;

namespace DayFusion.API.Models;

public class GetLogsRequest
{
    public DateTime? StartTime { get; set; }
    public DateTime? EndTime { get; set; }
    public string? FilterPattern { get; set; }
    public int? Limit { get; set; }
}

public class LogsResponse
{
    public List<LogEntry> Logs { get; set; } = new();
    public int TotalCount { get; set; }
    public string? NextToken { get; set; }
    public string? Message { get; set; }
}

public class LogEntry
{
    public DateTime Timestamp { get; set; }
    public string Message { get; set; } = string.Empty;
    public string? LogStreamName { get; set; }
}

