using System.ComponentModel.DataAnnotations;
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
    
    public TransactionStatus Status { get; set; } = TransactionStatus.Pending;
    
    public string? ReviewNotes { get; set; }
    
    public string? ReviewedBy { get; set; }
    
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    
    public DateTime? ProcessedAt { get; set; }
    
    public DateTime? ReviewedAt { get; set; }
    
    public string? RejectionReason { get; set; }
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
}

public class LivenessCompareRequest
{
    [Required]
    public string SessionId { get; set; } = string.Empty;
    
    [Required]
    public string DocumentKey { get; set; } = string.Empty;
}
