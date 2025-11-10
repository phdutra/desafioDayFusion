using System.ComponentModel.DataAnnotations;

namespace DayFusion.API.Models;

/// <summary>
/// Request para análise anti-deepfake de vídeo
/// </summary>
public class AntiDeepfakeAnalysisRequest
{
    [Required]
    public string VideoKey { get; set; } = string.Empty;
    
    public string? SessionId { get; set; }
}

/// <summary>
/// Resultado da análise anti-deepfake
/// </summary>
public class AntiDeepfakeResult
{
    public float DeepfakeScore { get; set; }      // 0.0 - 1.0 (probabilidade de ser deepfake)
    public float BlinkRate { get; set; }          // piscadas por minuto
    public string BlinkPattern { get; set; } = "unknown";  // "natural" | "anomalous" | "error"
    public string AudioSync { get; set; } = "unknown";     // "ok" | "lag" | "mismatch" | "error"
    public List<string> DetectedArtifacts { get; set; } = new();  // artefatos encontrados
    public string ModelVersion { get; set; } = "1.0.0";
}

/// <summary>
/// Request para verificação completa (Face + Anti-Deepfake)
/// </summary>
public class VerifyWithAntiDeepfakeRequest
{
    [Required]
    public string SelfieKey { get; set; } = string.Empty;
    
    [Required]
    public string DocumentKey { get; set; } = string.Empty;
    
    /// <summary>
    /// Chave S3 do vídeo curto (opcional) para análise anti-deepfake
    /// </summary>
    public string? VideoKey { get; set; }
    
    public string? TransactionId { get; set; }
}

/// <summary>
/// Response consolidada com Face Comparison + Anti-Deepfake
/// </summary>
public class VerifyWithAntiDeepfakeResponse
{
    public string TransactionId { get; set; } = string.Empty;
    public float SimilarityScore { get; set; }
    public TransactionStatus Status { get; set; }
    public string Message { get; set; } = string.Empty;
    
    /// <summary>
    /// Informações do Face Liveness (futuro)
    /// </summary>
    public LivenessInfo? Liveness { get; set; }
    
    /// <summary>
    /// Resultado da análise anti-deepfake
    /// </summary>
    public AntiDeepfakeResult? AntiDeepfake { get; set; }
}

/// <summary>
/// Informações do Face Liveness 3D
/// </summary>
public class LivenessInfo
{
    public string Decision { get; set; } = "UNKNOWN";  // REAL_PERSON | SPOOF | UNKNOWN
    public float Confidence { get; set; }
}

