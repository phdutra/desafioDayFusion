using DayFusion.API.Models;
using Microsoft.Extensions.Logging;

namespace DayFusion.API.Services;

public interface IValidationService
{
    double CalculateIdentityScore(double? liveness, double? match, double? document);
    string GenerateObservation(double finalScore, string? documentObs);
    TransactionStatus DetermineFinalStatus(double identityScore, double? liveness, double? match, double? document);
}

public class ValidationService : IValidationService
{
    private readonly ILogger<ValidationService> _logger;

    public ValidationService(ILogger<ValidationService> logger)
    {
        _logger = logger;
    }

    public double CalculateIdentityScore(double? liveness, double? match, double? document)
    {
        // CRÍTICO: Se documento inválido (score 0), retornar 0 imediatamente
        if ((document ?? 0) <= 0)
        {
            _logger.LogWarning("🚨 DocumentScore é 0 ou inválido, IdentityScore = 0");
            return 0.0;
        }

        // Normaliza valores para 0-1
        var livenessNorm = (liveness ?? 0) / 100.0; // Liveness já vem como 0-1 ou 0-100
        if (livenessNorm > 1.0) livenessNorm = livenessNorm / 100.0;
        
        var matchNorm = (match ?? 0) / 100.0;
        var documentNorm = (document ?? 0) / 100.0;

        // Score = SOMA ponderada: 33% Liveness + 33% Match + 34% Documento
        // Documento tem peso ligeiramente maior por ser validação crítica
        var score = (livenessNorm * 0.33) + (matchNorm * 0.33) + (documentNorm * 0.34);
        
        var finalScore = Math.Round(score, 4); // 0.0 - 1.0
        
        _logger.LogInformation("📊 Calculando IdentityScore. Liveness: {Liveness} ({LivenessNorm}), Match: {Match} ({MatchNorm}), Document: {Document} ({DocumentNorm}) = {FinalScore}",
            liveness, livenessNorm, match, matchNorm, document, documentNorm, finalScore);

        return finalScore;
    }

    public string GenerateObservation(double finalScore, string? documentObs)
    {
        string level = finalScore switch
        {
            >= 0.85 => "✅ Validação automática aprovada",
            >= 0.70 => "⚠️ Revisar documento manualmente",
            >= 0.50 => "🔍 Revisão obrigatória - possível fraude",
            _ => "🚨 Possível fraude — revisão obrigatória"
        };

        var observacao = level;
        if (!string.IsNullOrEmpty(documentObs))
        {
            observacao += $" | {documentObs}";
        }

        return observacao;
    }

    public TransactionStatus DetermineFinalStatus(double identityScore, double? liveness, double? match, double? document)
    {
        // CRÍTICO: Se documento tem score 0, rejeita imediatamente (não é RG/CNH)
        if ((document ?? 0) <= 0)
        {
            _logger.LogWarning("🚨 Documento rejeitado: score 0 (não é RG/CNH válido)");
            return TransactionStatus.Rejected;
        }

        // Normaliza liveness
        var livenessNorm = liveness ?? 0;
        if (livenessNorm > 1.0) livenessNorm = livenessNorm / 100.0;

        // Se qualquer componente crítico falhar, rejeitar
        if (livenessNorm < 0.50)
        {
            return TransactionStatus.Rejected;
        }

        if ((match ?? 0) < 50)
        {
            return TransactionStatus.Rejected;
        }

        // Documento deve ter pelo menos 30 pontos para ser válido
        if ((document ?? 0) < 30)
        {
            _logger.LogWarning("🚨 Documento rejeitado: score muito baixo ({DocumentScore})", document);
            return TransactionStatus.Rejected;
        }

        // Determina status baseado no score final
        return identityScore switch
        {
            >= 0.85 => TransactionStatus.Approved,
            >= 0.70 => TransactionStatus.ManualReview,
            >= 0.50 => TransactionStatus.ManualReview,
            _ => TransactionStatus.Rejected
        };
    }
}

