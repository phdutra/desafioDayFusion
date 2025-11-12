using System.ComponentModel.DataAnnotations;

namespace DayFusion.API.Models;

public record AnalysisDto(
    string SessionId,
    string UserId,
    string Status,
    float? MatchScore,
    float? LivenessScore,
    float? FraudScore,
    IReadOnlyCollection<string> AutoObservations,
    string? ManualObservation,
    string SelfieSignedUrl,
    string DocumentSignedUrl,
    string CreatedAt,
    string? ReviewedBy,
    string? ReviewedAt
);

public class SaveObservationRequest
{
    [Required]
    [StringLength(2_000, ErrorMessage = "A observação deve ter no máximo 2000 caracteres.")]
    public string ManualObservation { get; set; } = string.Empty;
}

public class UpdateStatusRequest
{
    [Required]
    [RegularExpression("APPROVED|REJECTED|REVIEW_REQUIRED", ErrorMessage = "Status inválido. Valores permitidos: APPROVED, REJECTED, REVIEW_REQUIRED.")]
    public string Status { get; set; } = string.Empty;

    [StringLength(2_000, ErrorMessage = "A observação deve ter no máximo 2000 caracteres.")]
    public string? ManualObservation { get; set; }
}

public record VerificationMetricsResponse(
    int Total,
    int Approved,
    int Rejected,
    int ReviewRequired,
    float? AvgMatchScore,
    float? AvgLivenessScore,
    float? AvgFraudScore,
    IReadOnlyCollection<ReasonCount> TopRejectionReasons
);

public record ReasonCount(string Reason, int Count);

