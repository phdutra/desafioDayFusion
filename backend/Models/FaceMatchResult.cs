namespace DayFusion.API.Models;

public class FaceMatchResult
{
    public bool IsSuccessful { get; set; }
    public float Similarity { get; set; }
    public string? MatchedFaceId { get; set; }
    public string Message { get; set; } = string.Empty;
}

