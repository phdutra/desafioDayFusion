using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using DayFusion.API.Models;
using DayFusion.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DayFusion.API.Controllers;

[ApiController]
[Route("api/verifications")]
[Authorize(Policy = "AdminOnly")]
public class VerificationsController : ControllerBase
{
    private readonly IDynamoDBService _dynamoDbService;
    private readonly IS3Service _s3Service;
    private readonly ILogger<VerificationsController> _logger;
    private readonly int _mediaExpiryMinutes;

    public VerificationsController(
        IDynamoDBService dynamoDbService,
        IS3Service s3Service,
        IConfiguration configuration,
        ILogger<VerificationsController> logger)
    {
        _dynamoDbService = dynamoDbService;
        _s3Service = s3Service;
        _logger = logger;
        _mediaExpiryMinutes = configuration.GetValue<int?>("Observations:MediaUrlExpiryMinutes") ?? 10;
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<AnalysisDto>>> List([FromQuery] int limit = 50)
    {
        limit = Math.Clamp(limit, 1, 200);
        var transactions = await _dynamoDbService.GetAllTransactionsAsync(limit);
        var mapped = await Task.WhenAll(transactions.Select(MapTransactionAsync));
        return Ok(mapped);
    }

    [HttpGet("{transactionId}")]
    public async Task<ActionResult<AnalysisDto>> Get(string transactionId)
    {
        if (string.IsNullOrWhiteSpace(transactionId))
        {
            return BadRequest(new { message = "transactionId é obrigatório." });
        }

        var transaction = await _dynamoDbService.GetTransactionAsync(transactionId);
        if (transaction is null)
        {
            return NotFound();
        }

        var dto = await MapTransactionAsync(transaction);
        return Ok(dto);
    }

    [HttpPost("{transactionId}/observation")]
    public async Task<IActionResult> SaveObservation(string transactionId, [FromBody] SaveObservationRequest request)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var transaction = await _dynamoDbService.GetTransactionAsync(transactionId);
        if (transaction is null)
        {
            return NotFound();
        }

        transaction.ReviewNotes = request.ManualObservation.Trim();
        transaction.ReviewedBy = ResolveReviewerIdentity();
        transaction.ReviewedAt = DateTime.UtcNow;
        transaction.ProcessedAt ??= DateTime.UtcNow;

        await _dynamoDbService.UpdateTransactionAsync(transaction);

        return NoContent();
    }

    [HttpPatch("{transactionId}/status")]
    public async Task<IActionResult> UpdateStatus(string transactionId, [FromBody] UpdateStatusRequest request)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var transaction = await _dynamoDbService.GetTransactionAsync(transactionId);
        if (transaction is null)
        {
            return NotFound();
        }

        var newStatus = ParseStatus(request.Status);
        if (newStatus is null)
        {
            return BadRequest(new { message = "Status inválido. Utilize APPROVED, REJECTED ou REVIEW_REQUIRED." });
        }

        transaction.Status = newStatus.Value;
        if (!string.IsNullOrWhiteSpace(request.ManualObservation))
        {
            transaction.ReviewNotes = request.ManualObservation.Trim();
        }

        transaction.ReviewedBy = ResolveReviewerIdentity();
        transaction.ReviewedAt = DateTime.UtcNow;

        if (transaction.ProcessedAt is null && transaction.Status is TransactionStatus.Approved or TransactionStatus.Rejected)
        {
            transaction.ProcessedAt = DateTime.UtcNow;
        }

        if (transaction.Status == TransactionStatus.Rejected && !string.IsNullOrWhiteSpace(transaction.ReviewNotes))
        {
            transaction.RejectionReason = transaction.ReviewNotes;
        }

        await _dynamoDbService.UpdateTransactionAsync(transaction);

        return NoContent();
    }

    [HttpGet("metrics")]
    public async Task<ActionResult<VerificationMetricsResponse>> Metrics([FromQuery] int limit = 200)
    {
        limit = Math.Clamp(limit, 10, 1_000);
        var transactions = await _dynamoDbService.GetAllTransactionsAsync(limit);

        var total = transactions.Count;
        var approved = transactions.Count(t => t.Status == TransactionStatus.Approved);
        var rejected = transactions.Count(t => t.Status == TransactionStatus.Rejected);
        var review = transactions.Count(t => t.Status == TransactionStatus.ManualReview);

        float? avgMatch = null;
        var matchScores = transactions.Where(t => t.SimilarityScore.HasValue).Select(t => t.SimilarityScore!.Value).ToList();
        if (matchScores.Count > 0)
        {
            avgMatch = matchScores.Average();
        }

        float? avgLiveness = null;
        var livenessScores = transactions.Where(t => t.LivenessScore.HasValue).Select(t => t.LivenessScore!.Value).ToList();
        if (livenessScores.Count > 0)
        {
            avgLiveness = livenessScores.Average();
        }

        float? avgFraud = null;
        var fraudScores = transactions.Where(t => t.DeepfakeScore.HasValue).Select(t => t.DeepfakeScore!.Value * 100f).ToList();
        if (fraudScores.Count > 0)
        {
            avgFraud = fraudScores.Average();
        }

        var reasons = transactions
            .SelectMany(t => CollectReasons(t))
            .GroupBy(reason => reason)
            .Select(group => new ReasonCount(group.Key, group.Count()))
            .OrderByDescending(x => x.Count)
            .ThenBy(x => x.Reason)
            .Take(5)
            .ToList();

        var response = new VerificationMetricsResponse(
            total,
            approved,
            rejected,
            review,
            avgMatch,
            avgLiveness,
            avgFraud,
            reasons);

        return Ok(response);
    }

    private async Task<AnalysisDto> MapTransactionAsync(Transaction transaction)
    {
        var selfieUrl = await ResolveMediaUrlAsync(transaction.SelfieUrl);
        var documentUrl = await ResolveMediaUrlAsync(transaction.DocumentUrl);
        var autoObservations = BuildAutoObservations(transaction).ToArray();

        return new AnalysisDto(
            transaction.Id,
            transaction.UserId,
            MapStatus(transaction.Status),
            transaction.SimilarityScore,
            transaction.LivenessScore,
            transaction.DeepfakeScore.HasValue ? transaction.DeepfakeScore.Value * 100f : null,
            autoObservations,
            string.IsNullOrWhiteSpace(transaction.ReviewNotes) ? null : transaction.ReviewNotes,
            selfieUrl,
            documentUrl,
            transaction.CreatedAt.ToString("O"),
            transaction.ReviewedBy,
            transaction.ReviewedAt?.ToString("O"));
    }

    private async Task<string> ResolveMediaUrlAsync(string? keyOrUrl)
    {
        if (string.IsNullOrWhiteSpace(keyOrUrl))
        {
            return string.Empty;
        }

        if (Uri.TryCreate(keyOrUrl, UriKind.Absolute, out var uri) && uri.Scheme.StartsWith("http", StringComparison.OrdinalIgnoreCase))
        {
            return keyOrUrl;
        }

        try
        {
            var presigned = await _s3Service.GeneratePresignedGetUrlAsync(keyOrUrl, TimeSpan.FromMinutes(_mediaExpiryMinutes));
            return presigned.Url;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Falha ao gerar URL assinada para a chave {Key}", keyOrUrl);
            return string.Empty;
        }
    }

    private static IReadOnlyCollection<string> BuildAutoObservations(Transaction transaction)
    {
        var observations = new List<string>();

        if (transaction.SimilarityScore is not null && transaction.SimilarityScore < 75)
        {
            observations.Add("Rosto não corresponde ao documento");
        }

        if (transaction.LivenessScore is > 0 and < 80)
        {
            observations.Add("Falha na verificação de presença (movimento insuficiente)");
        }

        if (transaction.DeepfakeScore.HasValue)
        {
            var fraud = transaction.DeepfakeScore.Value * 100f;
            if (fraud > 60f)
            {
                observations.Add("Indícios de manipulação de imagem");
            }
            else if (fraud >= 30f)
            {
                observations.Add("Análise anti-deepfake requer revisão");
            }
        }

        if (transaction.AutoObservations != null)
        {
            foreach (var auto in transaction.AutoObservations)
            {
                if (!string.IsNullOrWhiteSpace(auto))
                {
                    observations.Add(auto);
                }
            }
        }

        if (!string.IsNullOrWhiteSpace(transaction.RejectionReason))
        {
            observations.Add(transaction.RejectionReason);
        }

        if (!observations.Any() && transaction.Status == TransactionStatus.ManualReview)
        {
            observations.Add("Revisão manual pendente");
        }

        return observations
            .Where(o => !string.IsNullOrWhiteSpace(o))
            .Select(o => o.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static IEnumerable<string> CollectReasons(Transaction transaction)
    {
        if (!string.IsNullOrWhiteSpace(transaction.RejectionReason))
        {
            yield return transaction.RejectionReason;
        }

        foreach (var reason in BuildAutoObservations(transaction))
        {
            yield return reason;
        }
    }

    private static string MapStatus(TransactionStatus status) =>
        status switch
        {
            TransactionStatus.Approved => "APPROVED",
            TransactionStatus.Rejected => "REJECTED",
            TransactionStatus.ManualReview => "REVIEW_REQUIRED",
            TransactionStatus.Pending => "REVIEW_REQUIRED",
            TransactionStatus.Processing => "REVIEW_REQUIRED",
            _ => "REVIEW_REQUIRED"
        };

    private static TransactionStatus? ParseStatus(string status) =>
        status?.Trim().ToUpperInvariant() switch
        {
            "APPROVED" => TransactionStatus.Approved,
            "REJECTED" => TransactionStatus.Rejected,
            "REVIEW_REQUIRED" => TransactionStatus.ManualReview,
            _ => null
        };

    private string ResolveReviewerIdentity()
    {
        var email = User.FindFirst("email")?.Value;
        if (!string.IsNullOrWhiteSpace(email))
        {
            return email;
        }

        var username = User.Identity?.Name;
        if (!string.IsNullOrWhiteSpace(username))
        {
            return username;
        }

        var cognitoUsername = User.FindFirst("cognito:username")?.Value;
        if (!string.IsNullOrWhiteSpace(cognitoUsername))
        {
            return cognitoUsername;
        }

        return "admin";
    }
}

