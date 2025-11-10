using System.ComponentModel.DataAnnotations;

namespace DayFusion.API.Models;

/// <summary>
/// Modelo para listar usuários no painel administrativo
/// </summary>
public class UserManagementDto
{
    public string Cpf { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
    public bool IsApproved { get; set; }
    public bool HasFaceId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? LastLoginAt { get; set; }
}

/// <summary>
/// Request para aprovar/rejeitar usuário
/// </summary>
public class ApproveUserRequest
{
    [Required]
    [StringLength(11, MinimumLength = 11)]
    public string Cpf { get; set; } = string.Empty;

    [Required]
    public bool Approve { get; set; }
}

/// <summary>
/// Request para atualizar role do usuário
/// </summary>
public class UpdateRoleRequest
{
    [Required]
    [StringLength(11, MinimumLength = 11)]
    public string Cpf { get; set; } = string.Empty;

    [Required]
    [RegularExpression("^(Admin|User)$", ErrorMessage = "Role deve ser 'Admin' ou 'User'")]
    public string Role { get; set; } = "User";
}

