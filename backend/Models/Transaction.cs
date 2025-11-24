using System.ComponentModel.DataAnnotations;
using System.Collections.Generic;
using Amazon.DynamoDBv2.DataModel;

namespace DayFusion.API.Models;

// DynamoDB: tabela esperada "dayfusion_transactions"
[DynamoDBTable("dayfusion_transactions")]
public class Transaction
{
    [DynamoDBHashKey]
    [DynamoDBProperty("TransactionId")]
    [Key]
    public string Id { get; set; } = Guid.NewGuid().ToString();
    
    [Required]
    public string UserId { get; set; } = string.Empty;
    
    [Required]
    public string SelfieUrl { get; set; } = string.Empty;
    
    [Required]
    public string DocumentUrl { get; set; } = string.Empty;
    
    public float? SimilarityScore { get; set; }
    
    public float? LivenessScore { get; set; }
    
    public float? DocumentScore { get; set; }  // 0-100 (análise de autenticidade do documento)
    
    public double? IdentityScore { get; set; }  // 0.0-1.0 (score final combinado)
    
    public string? Observacao { get; set; }  // Observação automática gerada
    
    public TransactionStatus Status { get; set; } = TransactionStatus.Pending;
    
    public string? ReviewNotes { get; set; }
    
    public string? ReviewedBy { get; set; }
    
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    
    public List<string>? AutoObservations { get; set; }
    
    public DateTime? ProcessedAt { get; set; }
    
    public DateTime? ReviewedAt { get; set; }
    
    public string? RejectionReason { get; set; }
    
    // Anti-Deepfake Layer
    public float? DeepfakeScore { get; set; }  // 0.0 - 1.0 (probabilidade de ser deepfake)
    public string? BlinkPattern { get; set; }   // "natural" | "anomalous" | "error"
    public string? AudioSync { get; set; }      // "ok" | "lag" | "mismatch" | "error"
    public List<string>? DetectedArtifacts { get; set; }  // ["gan_edges", "warping", etc]
    public string? VideoKey { get; set; }       // chave S3 do vídeo curto
    public string? ModelVersion { get; set; }   // versão do modelo anti-deepfake
    public string? DeviceInfo { get; set; }     // JSON serializado (browser, OS, IP hash)
    public DateTime? VideoExpiresAt { get; set; }  // lifecycle S3 (1h-24h)
}

public enum TransactionStatus
{
    Pending,
    Processing,
    Approved,
    Rejected,
    ManualReview,
    Error
}

public class PresignedUrlRequest
{
    [Required]
    public string FileName { get; set; } = string.Empty;
    
    [Required]
    public string ContentType { get; set; } = string.Empty;
    
    public string? TransactionId { get; set; }
}

public class PresignedUrlResponse
{
    public string Url { get; set; } = string.Empty;
    public string Key { get; set; } = string.Empty;
    public DateTime ExpiresAt { get; set; }
}

public class PresignedGetRequest
{
    [Required]
    public string Key { get; set; } = string.Empty;
    public int ExpiryMinutes { get; set; } = 60;
}

public class FaceComparisonRequest
{
    [Required]
    public string SelfieKey { get; set; } = string.Empty;
    
    [Required]
    public string DocumentKey { get; set; } = string.Empty;
    
    public string? TransactionId { get; set; }
}

public class DetectFaceRequest
{
    [Required]
    public string ImageKey { get; set; } = string.Empty;
}

public class FaceComparisonResponse
{
    public float SimilarityScore { get; set; }
    public TransactionStatus Status { get; set; }
    public string? Message { get; set; }
    public string TransactionId { get; set; } = string.Empty;
}

public class ReviewRequest
{
    [Required]
    public string TransactionId { get; set; } = string.Empty;
    
    [Required]
    public TransactionStatus Status { get; set; }
    
    public string? Notes { get; set; }
}

public class AuthRequest
{
    [Required]
    public string Username { get; set; } = string.Empty;
    
    [Required]
    public string Password { get; set; } = string.Empty;
}

public class AuthResponse
{
    public string AccessToken { get; set; } = string.Empty;
    public string RefreshToken { get; set; } = string.Empty;
    public DateTime ExpiresAt { get; set; }
    public string UserId { get; set; } = string.Empty;
}

// Face Liveness 3D Models
public class StartLivenessRequest
{
    public string? TransactionId { get; set; }
}

public class LivenessSessionResponse
{
    public string SessionId { get; set; } = string.Empty;
    public string StreamingUrl { get; set; } = string.Empty;
    public string TransactionId { get; set; } = string.Empty;
    public DateTime ExpiresAt { get; set; }
}

public class GetLivenessResultRequest
{
    [Required]
    public string SessionId { get; set; } = string.Empty;
    
    public string? TransactionId { get; set; }
    
    public string? DocumentKey { get; set; }  // Chave S3 do documento (opcional, para análise completa)
    
    public string? SelfieKey { get; set; }  // Chave S3 da selfie de referência (opcional)
    
    public float? LocalLivenessScore { get; set; }  // Score de liveness calculado localmente pelo frontend (0-100)
    
    public string? VideoKey { get; set; }  // Chave S3 do vídeo gravado durante a captura (opcional)
}

public class LivenessResultResponse
{
    public string SessionId { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty; // SUCCEEDED, FAILED, etc
    public string LivenessDecision { get; set; } = string.Empty; // LIVE, SPOOF, etc
    public float Confidence { get; set; }
    public string TransactionId { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public string? ReferenceImageUrl { get; set; } // URL da imagem de referência
    public List<string> AuditImageUrls { get; set; } = new(); // URLs das imagens de auditoria
    
    // Informações detalhadas sobre score baixo
    public List<string> LowScoreReasons { get; set; } = new(); // Razões para score baixo
    public List<string> Recommendations { get; set; } = new(); // Recomendações para melhorar
    public float? QualityScore { get; set; } // Score de qualidade da imagem (0-100)
    public string? QualityAssessment { get; set; } // Avaliação da qualidade (EXCELLENT, GOOD, FAIR, POOR)
    
    // Campos adicionais para análise completa
    public string? Observacao { get; set; } // Observação da análise
    public float? DocumentScore { get; set; } // Score do documento (0-100)
    public double? IdentityScore { get; set; } // Score de identidade completo (0-100)
    public float? MatchScore { get; set; } // Score de match de faces (0-100)
}

public class LivenessCompareRequest
{
    [Required]
    public string SessionId { get; set; } = string.Empty;
    
    [Required]
    public string DocumentKey { get; set; } = string.Empty;
}

// Document Validation Models
public class DocumentAnalysisResult
{
    public double DocumentScore { get; set; }  // 0-100
    public string Observacao { get; set; } = string.Empty;
    public List<string> Flags { get; set; } = new();
}

public class IdentityRequest
{
    [Required]
    public string Bucket { get; set; } = string.Empty;
    
    [Required]
    public string FileName { get; set; } = string.Empty;
    
    public double? LivenessScore { get; set; }
    
    public double? MatchScore { get; set; }
    
    public string? TransactionId { get; set; }
}

public class IdentityResponse
{
    public string TransactionId { get; set; } = string.Empty;
    public double? LivenessScore { get; set; }
    public double? MatchScore { get; set; }
    public double DocumentScore { get; set; }
    public double IdentityScore { get; set; }
    public string Observacao { get; set; } = string.Empty;
    public TransactionStatus Status { get; set; }
}
