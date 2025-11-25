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
        // Liveness pode vir como 0-100 (percentual) ou 0-1 (já normalizado)
        var livenessNorm = liveness ?? 0;
        if (livenessNorm > 1.0)
        {
            // Se maior que 1, assume que está em percentual (0-100) e normaliza
            livenessNorm = livenessNorm / 100.0;
        }
        // Se já está entre 0-1, mantém como está
        
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
        // CRÍTICO: Se documento tem score 0 ou negativo, rejeita imediatamente (não é RG/CNH)
        var documentValue = document ?? 0;
        if (documentValue <= 0)
        {
            _logger.LogWarning("🚨 Documento rejeitado: score {DocumentScore} (não é RG/CNH válido). Rejeitando independente de outros scores.", documentValue);
            return TransactionStatus.Rejected;
        }

        // Normaliza liveness
        // Liveness pode vir como 0-100 (percentual) ou 0-1 (já normalizado)
        var livenessNorm = liveness ?? 0;
        if (livenessNorm > 1.0)
        {
            // Se maior que 1, assume que está em percentual (0-100) e normaliza
            livenessNorm = livenessNorm / 100.0;
        }
        // Se já está entre 0-1, mantém como está

        // Se qualquer componente crítico falhar, rejeitar
        if (livenessNorm < 0.50)
        {
            return TransactionStatus.Rejected;
        }

        if ((match ?? 0) < 50)
        {
            return TransactionStatus.Rejected;
        }

        // Documento deve ter pelo menos 50 pontos para ser válido (RG/CNH autêntico)
        // Score < 50 indica documento suspeito ou de baixa qualidade
        if (documentValue < 50)
        {
            _logger.LogWarning("🚨 Documento rejeitado: score muito baixo ({DocumentScore}). Mínimo necessário: 50. Rejeitando.", documentValue);
            return TransactionStatus.Rejected;
        }

        // Determina status baseado no score final
        // Log detalhado para debug
        _logger.LogInformation("📊 DetermineFinalStatus: IdentityScore={IdentityScore}, Liveness={Liveness} ({LivenessNorm}), Match={Match}, Document={Document}",
            identityScore, liveness, livenessNorm, match, document);
        
        // CRÍTICO: Garantir que documento válido é obrigatório para aprovação
        // Mesmo com scores altos, se documento não for válido (RG/CNH), não aprovar
        var matchValue = match ?? 0;
        var hasHighMatch = matchValue >= 95;
        var hasValidDocument = documentValue >= 85; // Documento deve ter score >= 85 para ser considerado "válido" para aprovação
        
        TransactionStatus status;
        
        // REGRA CRÍTICA: Documento válido (RG/CNH) é OBRIGATÓRIO para aprovação
        if (!hasValidDocument && documentValue < 85)
        {
            _logger.LogWarning("🚨 Documento com score {DocumentScore} abaixo do mínimo (85) necessário para aprovação - REJEITANDO",
                documentValue);
            return TransactionStatus.Rejected;
        }
        
        if (identityScore >= 0.85 && hasValidDocument)
        {
            // Score alto + Documento válido → aprovar
            status = TransactionStatus.Approved;
        }
        else if (identityScore >= 0.80 && hasHighMatch && hasValidDocument && livenessNorm >= 0.70)
        {
            // Score bom (>= 0.80) + Match alto (>= 95) + Documento válido (>= 85) + Liveness razoável (>= 70) → aprovar
            _logger.LogInformation("✅ Aprovando com score {IdentityScore}: Match alto ({Match}%), Documento válido ({Document}%), Liveness {LivenessNorm}",
                identityScore, matchValue, documentValue, livenessNorm);
            status = TransactionStatus.Approved;
        }
        else if (identityScore >= 0.70 && hasValidDocument)
        {
            status = TransactionStatus.ManualReview;
        }
        else if (identityScore >= 0.50 && hasValidDocument)
        {
            status = TransactionStatus.ManualReview;
        }
        else
        {
            // Sem documento válido ou score muito baixo → rejeitar
            if (!hasValidDocument)
            {
                _logger.LogWarning("🚨 Rejeitando: Documento não é válido (score {DocumentScore} < 85)", documentValue);
            }
            status = TransactionStatus.Rejected;
        }
        
        _logger.LogInformation("✅ Status final determinado: {Status} (IdentityScore: {IdentityScore}, Match: {Match}%, Document: {Document}%)", 
            status, identityScore, matchValue, documentValue);
        
        return status;
    }
}

