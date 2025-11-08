using System.Collections.Generic;

namespace DayFusion.API.Models;

public class LivenessHistoryItem
{
    public string SessionId { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public float? LivenessScore { get; set; }
    public string Status { get; set; } = "Desconhecido";
    public List<LivenessHistoryCapture> Captures { get; set; } = new();
    public LivenessHistoryVideo? Video { get; set; }
    public Dictionary<string, string>? Metadata { get; set; }
}

public class LivenessHistoryCapture
{
    public string Key { get; set; } = string.Empty;
    public string Url { get; set; } = string.Empty;
    public string? Position { get; set; }
    public long Size { get; set; }
    public DateTime LastModified { get; set; }
}

public class LivenessHistoryVideo
{
    public string Key { get; set; } = string.Empty;
    public string Url { get; set; } = string.Empty;
    public string MimeType { get; set; } = "video/webm";
    public long Size { get; set; }
    public double? DurationSeconds { get; set; }
}

