using DayFusion.API.Models;
using DayFusion.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DayFusion.API.Controllers;

[ApiController]
[Route("api/identity")]
[AllowAnonymous]
public class IdentityController : ControllerBase
{
    private readonly IDocumentAnalyzerService _docAnalyzer;
    private readonly IValidationService _validator;
    private readonly IDynamoDBService _dynamoService;
    private readonly IConfiguration _configuration;
    private readonly ILogger<IdentityController> _logger;

    public IdentityController(
        IDocumentAnalyzerService docAnalyzer,
        IValidationService validator,
        IDynamoDBService dynamoService,
        IConfiguration configuration,
        ILogger<IdentityController> logger)
    {
        _docAnalyzer = docAnalyzer;
        _validator = validator;
        _dynamoService = dynamoService;
        _configuration = configuration;
        _logger = logger;
    }

    /// <summary>
    /// Valida identidade completa: Liveness + Match + Documento
    /// </summary>
    [HttpPost("validate")]
    public async Task<IActionResult> ValidateIdentity([FromBody] IdentityRequest request)
    {
        try
        {
            _logger.LogInformation("🔍 Iniciando validação completa de identidade. TransactionId: {TransactionId}", request.TransactionId);

            // 1. Analisar documento
            _logger.LogInformation("📄 Analisando documento: {FileName} no bucket {Bucket}", request.FileName, request.Bucket);
            var docAnalysis = await _docAnalyzer.AnalyzeAsync(request.Bucket, request.FileName);

            // 2. Calcular score final
            var identityScore = _validator.CalculateIdentityScore(
                request.LivenessScore,
                request.MatchScore,
                docAnalysis.DocumentScore);

            // 3. Gerar observação
            var observacao = _validator.GenerateObservation(identityScore, docAnalysis.Observacao);

            // 4. Determinar status final
            var status = _validator.DetermineFinalStatus(
                identityScore,
                request.LivenessScore,
                request.MatchScore,
                docAnalysis.DocumentScore);

            var transactionId = request.TransactionId ?? Guid.NewGuid().ToString();

            // 5. Persistir transação (best-effort)
            try
            {
                var userId = GetCurrentUserId();
                var transaction = new Transaction
                {
                    Id = transactionId,
                    UserId = userId,
                    DocumentUrl = request.FileName,
                    LivenessScore = (float?)(request.LivenessScore * 100), // Normaliza para 0-100 se necessário
                    SimilarityScore = (float?)(request.MatchScore),
                    DocumentScore = (float)docAnalysis.DocumentScore,
                    IdentityScore = identityScore,
                    Observacao = observacao,
                    Status = status,
                    ProcessedAt = DateTime.UtcNow,
                    CreatedAt = DateTime.UtcNow,
                    AutoObservations = docAnalysis.Flags.Any() ? docAnalysis.Flags : null
                };

                await _dynamoService.CreateTransactionAsync(transaction);
                _logger.LogInformation("✅ Transação {TransactionId} persistida com sucesso", transactionId);
            }
            catch (Exception exPersist)
            {
                _logger.LogError(exPersist, "⚠️ Falha ao persistir transação {TransactionId}", transactionId);
                // Não falha a requisição
            }

            var response = new IdentityResponse
            {
                TransactionId = transactionId,
                LivenessScore = request.LivenessScore,
                MatchScore = request.MatchScore,
                DocumentScore = docAnalysis.DocumentScore,
                IdentityScore = identityScore,
                Observacao = observacao,
                Status = status
            };

            _logger.LogInformation("✅ Validação completa concluída. TransactionId: {TransactionId}, IdentityScore: {IdentityScore}, Status: {Status}",
                transactionId, identityScore, status);

            return Ok(response);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "❌ Erro ao validar identidade. TransactionId: {TransactionId}", request.TransactionId);
            return StatusCode(500, new { message = "Erro ao processar validação de identidade", error = ex.Message });
        }
    }

    /// <summary>
    /// Valida apenas o documento (RG/CNH) antes de iniciar liveness
    /// </summary>
    [HttpPost("document/validate")]
    public async Task<IActionResult> ValidateDocument([FromBody] DocumentValidateRequest request)
    {
        try
        {
            _logger.LogInformation("🔍 Validando documento: {DocumentKey} no bucket {Bucket}", request.DocumentKey, request.Bucket);

            var bucketName = request.Bucket;
            if (string.IsNullOrEmpty(bucketName))
            {
                bucketName = _configuration["AWS:S3Bucket"] ?? _configuration["AWS_S3_BUCKET"] ?? "dayfusion-bucket";
            }

            // Analisar documento (valida se é RG/CNH)
            var docAnalysis = await _docAnalyzer.AnalyzeAsync(bucketName, request.DocumentKey);

            _logger.LogInformation("✅ Validação de documento concluída. DocumentScore: {DocScore}, Flags: {Flags}, IsValid: {IsValid}",
                docAnalysis.DocumentScore, string.Join(", ", docAnalysis.Flags), 
                docAnalysis.DocumentScore > 0 && !docAnalysis.Flags.Contains("nao_e_documento") && !docAnalysis.Flags.Contains("fraude_nao_e_documento"));

            // Determinar se documento é válido (RG/CNH)
            var isValid = docAnalysis.DocumentScore > 0 
                && !docAnalysis.Flags.Contains("nao_e_documento") 
                && !docAnalysis.Flags.Contains("fraude_nao_e_documento");

            var response = new DocumentValidateResponse
            {
                DocumentScore = docAnalysis.DocumentScore,
                Observacao = docAnalysis.Observacao,
                Flags = docAnalysis.Flags,
                IsValid = isValid
            };

            return Ok(response);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "❌ Erro ao validar documento: {DocumentKey}", request.DocumentKey);
            return StatusCode(500, new { message = "Erro ao processar validação do documento", error = ex.Message });
        }
    }

    private string GetCurrentUserId()
    {
        return User.FindFirst("sub")?.Value ?? "anonymous";
    }
}

