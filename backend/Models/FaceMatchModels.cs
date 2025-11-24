namespace DayFusion.API.Models;

public class MatchFromLivenessRequest
{
    public string DocumentImageS3Path { get; set; } = default!; // "s3://bucket/key"
    public string SessionId { get; set; } = default!;
    public List<AuditImageDto> AuditImages { get; set; } = new();
}

public class AuditImageDto
{
    public string Bucket { get; set; } = default!;
    public string Key { get; set; } = default!;
}

public class MatchFromLivenessResponse
{
    public string SessionId { get; set; } = default!;
    public double LivenessScore { get; set; }
    public double BestMatchScore { get; set; }
    public string? BestMatchImageKey { get; set; }
    public List<MatchDetailDto> Matches { get; set; } = new();
    public double FinalScore { get; set; }
}

public class MatchDetailDto
{
    public string ImageKey { get; set; } = default!;
    public double Similarity { get; set; }
    public double Confidence { get; set; }
}

