using System.ComponentModel.DataAnnotations;

namespace DayFusion.API.Models;

public class CpfLookupResponse
{
    public string Cpf { get; set; } = string.Empty;
    public bool Exists { get; set; }
    public bool HasFaceId { get; set; }
    public string? Name { get; set; }
    public string? FaceId { get; set; }
    public string? FaceImageUrl { get; set; }
    public string? FaceImageKey { get; set; }
}

public class FaceEnrollmentRequest
{
    [Required]
    [StringLength(14, MinimumLength = 11)]
    public string Cpf { get; set; } = string.Empty;

    [Required]
    [StringLength(200)]
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Chave do objeto no S3 correspondente à imagem aprovada pelo Liveness.
    /// </summary>
    [Required]
    public string ImageKey { get; set; } = string.Empty;
}

public class FaceEnrollmentResponse
{
    public string Cpf { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string FaceId { get; set; } = string.Empty;
    public string FaceImageUrl { get; set; } = string.Empty;
    public string FaceImageKey { get; set; } = string.Empty;
    public AuthResponse Tokens { get; set; } = new();
}

public class FaceLoginRequest
{
    /// <summary>
    /// CPF do usuário (opcional). Se vazio, busca qualquer face na coleção.
    /// </summary>
    [StringLength(14, MinimumLength = 0)]
    public string Cpf { get; set; } = string.Empty;

    /// <summary>
    /// Chave do objeto no S3 capturado durante a autenticação atual.
    /// </summary>
    [Required]
    public string ImageKey { get; set; } = string.Empty;
}

public class FaceLoginResponse
{
    public bool Success { get; set; }
    public float SimilarityScore { get; set; }
    public string Message { get; set; } = string.Empty;
    public AuthResponse Tokens { get; set; } = new();
    public object? User { get; set; } // Dados do usuário autenticado (Cpf, Name)
}

public class RefreshTokenRequest
{
    [Required]
    [StringLength(14, MinimumLength = 11)]
    public string Cpf { get; set; } = string.Empty;

    public string? RefreshToken { get; set; }
}

