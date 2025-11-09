using Amazon.DynamoDBv2.DataModel;
using System.ComponentModel.DataAnnotations;

namespace DayFusion.API.Models;

/// <summary>
/// Representa o usuário habilitado para login por FaceID.
/// Tabela esperada no DynamoDB: "dayfusion_users"
/// </summary>
[DynamoDBTable("dayfusion_users")]
public class UserProfile
{
    [DynamoDBHashKey]
    [Required]
    [StringLength(11, MinimumLength = 11)]
    public string Cpf { get; set; } = string.Empty;

    [DynamoDBProperty]
    [Required]
    [StringLength(200)]
    public string Name { get; set; } = string.Empty;

    [DynamoDBProperty]
    public string? FaceId { get; set; }

    [DynamoDBProperty]
    public string? FaceImageKey { get; set; }

    [DynamoDBProperty]
    public string? FaceImageUrl { get; set; }

    [DynamoDBProperty]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [DynamoDBProperty]
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    [DynamoDBProperty]
    public DateTime? LastLoginAt { get; set; }

    [DynamoDBIgnore]
    public bool HasFaceId => !string.IsNullOrWhiteSpace(FaceId);
}

