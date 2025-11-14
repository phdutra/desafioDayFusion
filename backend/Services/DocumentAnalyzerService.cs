using Amazon.Rekognition;
using Amazon.Rekognition.Model;
using Amazon.S3;
using Amazon.S3.Model;
using DayFusion.API.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace DayFusion.API.Services;

public interface IDocumentAnalyzerService
{
    Task<DocumentAnalysisResult> AnalyzeAsync(string bucket, string fileName);
}

public class DocumentAnalyzerService : IDocumentAnalyzerService
{
    private readonly IAmazonRekognition _rekognition;
    private readonly IAmazonS3 _s3Client;
    private readonly IConfiguration _config;
    private readonly ILogger<DocumentAnalyzerService> _logger;
    private readonly string _bucketName;

    public DocumentAnalyzerService(
        IAmazonRekognition rekognition,
        IAmazonS3 s3Client,
        IConfiguration config,
        ILogger<DocumentAnalyzerService> logger)
    {
        _rekognition = rekognition;
        _s3Client = s3Client;
        _config = config;
        _logger = logger;
        _bucketName = _config["AWS:S3Bucket"] ?? _config["AWS_S3_BUCKET"]
            ?? throw new ArgumentNullException("AWS:S3Bucket", "Configure 'AWS:S3Bucket' em appsettings ou 'AWS_S3_BUCKET' como variável de ambiente.");
    }

    public async Task<DocumentAnalysisResult> AnalyzeAsync(string bucket, string fileName)
    {
        try
        {
            _logger.LogInformation("🔍 Iniciando análise de documento. Bucket: {Bucket}, FileName: {FileName}", bucket, fileName);

            double score = 0;
            var observacoes = new List<string>();
            var flags = new List<string>();

            // 1. Análise de Face no Documento (DetectFaces)
            var faceAnalysis = await AnalyzeFaceInDocumentAsync(bucket, fileName);
            score += faceAnalysis.Score;
            if (!string.IsNullOrEmpty(faceAnalysis.Observacao))
                observacoes.Add(faceAnalysis.Observacao);
            if (faceAnalysis.Flags.Any())
                flags.AddRange(faceAnalysis.Flags);

            _logger.LogInformation("📊 Face analysis score: {Score}", faceAnalysis.Score);

            // 2. Análise de Texto (OCR - DetectText)
            var textAnalysis = await AnalyzeTextInDocumentAsync(bucket, fileName);
            score += textAnalysis.Score;
            if (!string.IsNullOrEmpty(textAnalysis.Observacao))
                observacoes.Add(textAnalysis.Observacao);
            if (textAnalysis.Flags.Any())
                flags.AddRange(textAnalysis.Flags);

            _logger.LogInformation("📊 Text analysis score: {Score}", textAnalysis.Score);

            // 3. Análise de Qualidade da Imagem
            var qualityAnalysis = await AnalyzeImageQualityAsync(bucket, fileName);
            score += qualityAnalysis.Score;
            if (!string.IsNullOrEmpty(qualityAnalysis.Observacao))
                observacoes.Add(qualityAnalysis.Observacao);
            if (qualityAnalysis.Flags.Any())
                flags.AddRange(qualityAnalysis.Flags);

            _logger.LogInformation("📊 Quality analysis score: {Score}", qualityAnalysis.Score);

            // 4. Verificações Anti-Fraude Adicionais
            var fraudChecks = await PerformFraudChecksAsync(bucket, fileName, faceAnalysis, textAnalysis);
            score += fraudChecks.Score;
            if (!string.IsNullOrEmpty(fraudChecks.Observacao))
                observacoes.Add(fraudChecks.Observacao);
            if (fraudChecks.Flags.Any())
                flags.AddRange(fraudChecks.Flags);

            _logger.LogInformation("📊 Fraud checks score: {Score}", fraudChecks.Score);

            // Garante limite 0–100
            score = Math.Min(Math.Max(score, 0), 100);

            // Gera observação consolidada
            string observacao;
            
            // Se não é RG/CNH, força score 0 e rejeita
            if (flags.Contains("nao_e_documento") || flags.Contains("fraude_nao_e_documento"))
            {
                score = 0;
                observacao = "🚨 Documento rejeitado: não é RG ou CNH válido";
            }
            else
            {
                observacao = score switch
                {
                    >= 85 => "✅ Documento visualmente autêntico (RG/CNH válido)",
                    >= 70 => "⚠️ Documento válido (RG/CNH), mas revisar manualmente",
                    >= 50 => "🔍 Documento suspeito (RG/CNH) - revisão obrigatória",
                    _ => "🚨 Documento altamente suspeito - possível fraude"
                };
            }

            // Adiciona flags se houver
            if (flags.Any())
            {
                observacao += $" | Flags: {string.Join(", ", flags)}";
            }

            _logger.LogInformation("✅ Análise de documento concluída. Score final: {Score}, Observação: {Observacao}", score, observacao);

            return new DocumentAnalysisResult
            {
                DocumentScore = Math.Round(score, 2),
                Observacao = observacao,
                Flags = flags
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "❌ Erro ao analisar documento. Bucket: {Bucket}, FileName: {FileName}", bucket, fileName);
            return new DocumentAnalysisResult
            {
                DocumentScore = 0,
                Observacao = "🚨 Erro ao processar análise do documento",
                Flags = new List<string> { "erro_processamento" }
            };
        }
    }

    private async Task<AnalysisComponent> AnalyzeFaceInDocumentAsync(string bucket, string fileName)
    {
        try
        {
            var request = new DetectFacesRequest
            {
                Image = new Image
                {
                    S3Object = new Amazon.Rekognition.Model.S3Object
                    {
                        Bucket = bucket,
                        Name = fileName
                    }
                },
                Attributes = new List<string> { "ALL" }
            };

            var response = await _rekognition.DetectFacesAsync(request);
            var score = 0.0;
            var observacoes = new List<string>();
            var flags = new List<string>();

            // 1. Face detectada (40 pontos)
            if (response.FaceDetails != null && response.FaceDetails.Any())
            {
                score += 40;
                var faceCount = response.FaceDetails.Count;
                if (faceCount > 1)
                {
                    flags.Add("multiplas_faces");
                    observacoes.Add($"⚠️ Múltiplas faces detectadas ({faceCount})");
                }
            }
            else
            {
                flags.Add("sem_face");
                observacoes.Add("❌ Nenhuma face detectada no documento");
                return new AnalysisComponent { Score = 0, Observacao = string.Join(" | ", observacoes), Flags = flags };
            }

            var bestFace = response.FaceDetails!
                .OrderByDescending(f => f.Confidence ?? 0)
                .First();

            // 2. Brilho equilibrado (15 pontos)
            var brightness = bestFace.Quality?.Brightness ?? 0;
            if (brightness > 40 && brightness < 80)
            {
                score += 15;
            }
            else if (brightness < 20 || brightness > 95)
            {
                flags.Add("iluminacao_extrema");
                observacoes.Add($"⚠️ Iluminação extrema (brightness: {brightness:F1})");
            }
            else
            {
                score += 7; // Pontuação parcial
            }

            // 3. Nitidez adequada (15 pontos)
            var sharpness = bestFace.Quality?.Sharpness ?? 0;
            if (sharpness > 40)
            {
                score += 15;
            }
            else if (sharpness < 20)
            {
                flags.Add("baixa_nitidez");
                observacoes.Add($"⚠️ Baixa nitidez (sharpness: {sharpness:F1})");
            }
            else
            {
                score += 7; // Pontuação parcial
            }

            // 4. Confiança alta (10 pontos)
            var confidence = bestFace.Confidence ?? 0;
            if (confidence > 90)
            {
                score += 10;
            }
            else if (confidence < 70)
            {
                flags.Add("baixa_confianca_face");
                observacoes.Add($"⚠️ Baixa confiança na detecção da face ({confidence:F1}%)");
            }
            else
            {
                score += 5; // Pontuação parcial
            }

            return new AnalysisComponent
            {
                Score = score,
                Observacao = observacoes.Any() ? string.Join(" | ", observacoes) : null,
                Flags = flags
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Erro ao analisar face no documento");
            return new AnalysisComponent { Score = 0, Observacao = "Erro ao analisar face", Flags = new List<string> { "erro_face" } };
        }
    }

    private async Task<AnalysisComponent> AnalyzeTextInDocumentAsync(string bucket, string fileName)
    {
        try
        {
            var request = new DetectTextRequest
            {
                Image = new Image
                {
                    S3Object = new Amazon.Rekognition.Model.S3Object
                    {
                        Bucket = bucket,
                        Name = fileName
                    }
                }
            };

            var response = await _rekognition.DetectTextAsync(request);
            var score = 0.0;
            var observacoes = new List<string>();
            var flags = new List<string>();

            // Verifica se há texto detectado
            var textDetections = response.TextDetections?
                .Where(t => t.Type == TextTypes.LINE || t.Type == TextTypes.WORD)
                .ToList() ?? new List<TextDetection>();

            if (!textDetections.Any())
            {
                flags.Add("sem_texto");
                flags.Add("nao_e_documento");
                observacoes.Add("❌ Nenhum texto detectado no documento");
                return new AnalysisComponent
                {
                    Score = 0,
                    Observacao = "🚨 Documento inválido: não é RG ou CNH (sem texto detectado)",
                    Flags = flags
                };
            }

            // Extrai todo o texto para análise
            var allText = string.Join(" ", textDetections.Select(t => t.DetectedText ?? "").Where(t => !string.IsNullOrWhiteSpace(t)));
            var allTextUpper = allText.ToUpperInvariant();

            _logger.LogInformation("📝 Texto detectado no documento (primeiros 200 chars): {Text}", 
                allText.Length > 200 ? allText.Substring(0, 200) + "..." : allText);

            // Validação crítica: verifica se é RG ou CNH
            var isRgOrCnh = ValidateRgOrCnh(allTextUpper, out var validationFlags, out var validationObs);
            
            if (!isRgOrCnh)
            {
                flags.AddRange(validationFlags);
                flags.Add("nao_e_documento");
                observacoes.AddRange(validationObs);
                return new AnalysisComponent
                {
                    Score = 0,
                    Observacao = "🚨 Documento inválido: não é RG ou CNH válido",
                    Flags = flags
                };
            }

            // Se passou na validação, continua com análise de qualidade
            score += 30; // Documento válido (RG/CNH)

            // Verifica qualidade do texto (confiança)
            var avgConfidence = textDetections.Average(t => t.Confidence ?? 0);
            if (avgConfidence > 80)
            {
                score += 10; // Texto legível
            }
            else if (avgConfidence < 50)
            {
                flags.Add("texto_ilegivel");
                observacoes.Add($"⚠️ Texto com baixa confiança ({avgConfidence:F1}%)");
            }
            else
            {
                score += 5; // Pontuação parcial
            }

            // Verifica quantidade de texto (documentos reais têm bastante texto)
            var lineCount = textDetections.Count(t => t.Type == TextTypes.LINE);
            if (lineCount < 5)
            {
                flags.Add("pouco_texto");
                observacoes.Add($"⚠️ Pouco texto detectado ({lineCount} linhas)");
            }
            else
            {
                score += 10; // Quantidade adequada de texto
            }

            return new AnalysisComponent
            {
                Score = score,
                Observacao = observacoes.Any() ? string.Join(" | ", observacoes) : null,
                Flags = flags
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Erro ao analisar texto no documento");
            return new AnalysisComponent { Score = 0, Observacao = "Erro ao analisar texto", Flags = new List<string> { "erro_texto", "nao_e_documento" } };
        }
    }

    /// <summary>
    /// Valida se o texto detectado corresponde a um RG ou CNH brasileiro
    /// </summary>
    private bool ValidateRgOrCnh(string text, out List<string> flags, out List<string> observacoes)
    {
        flags = new List<string>();
        observacoes = new List<string>();
        var foundIndicators = new List<string>();

        // Palavras-chave obrigatórias para RG/CNH
        var requiredKeywords = new[]
        {
            "CPF",           // CPF é obrigatório
            "RG",            // RG ou
            "CARTEIRA",      // Carteira Nacional
            "IDENTIDADE",    // Identidade
            "BRASIL",        // Brasil
            "BRASILEIRA",    // Brasileira
            "NACIONAL"       // Nacional
        };

        // Palavras-chave que indicam RG
        var rgKeywords = new[]
        {
            "REGISTRO GERAL",
            "RG",
            "IDENTIDADE",
            "CARTEIRA DE IDENTIDADE"
        };

        // Palavras-chave que indicam CNH
        var cnhKeywords = new[]
        {
            "CARTEIRA NACIONAL",
            "CNH",
            "HABILITAÇÃO",
            "HABILITACAO",
            "CATEGORIA",
            "PERMISSAO",
            "PERMISSÃO"
        };

        // Verifica se tem pelo menos uma palavra-chave de RG ou CNH
        var hasRgKeyword = rgKeywords.Any(kw => text.Contains(kw));
        var hasCnhKeyword = cnhKeywords.Any(kw => text.Contains(kw));

        if (!hasRgKeyword && !hasCnhKeyword)
        {
            flags.Add("sem_indicador_rg_cnh");
            observacoes.Add("❌ Não encontrado indicador de RG ou CNH");
            return false;
        }

        if (hasRgKeyword) foundIndicators.Add("RG");
        if (hasCnhKeyword) foundIndicators.Add("CNH");

        // Verifica CPF (obrigatório em ambos)
        var cpfPattern = @"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b"; // Formato: 123.456.789-00 ou 12345678900
        var hasCpf = System.Text.RegularExpressions.Regex.IsMatch(text, cpfPattern);
        
        if (!hasCpf)
        {
            // Tenta padrão mais flexível (apenas números)
            var cpfNumbersOnly = System.Text.RegularExpressions.Regex.Matches(text, @"\d{11}");
            if (cpfNumbersOnly.Count == 0)
            {
                flags.Add("sem_cpf");
                observacoes.Add("❌ CPF não encontrado no documento");
                return false;
            }
            // Se encontrou 11 dígitos, considera válido (pode ser CPF)
            foundIndicators.Add("CPF (possível)");
        }
        else
        {
            foundIndicators.Add("CPF");
        }

        // Verifica se tem texto suficiente (documentos reais têm muito texto)
        var wordCount = text.Split(new[] { ' ', '\n', '\t' }, StringSplitOptions.RemoveEmptyEntries).Length;
        if (wordCount < 15) // Aumentado de 10 para 15 palavras
        {
            flags.Add("texto_insuficiente");
            observacoes.Add($"❌ Texto insuficiente ({wordCount} palavras) - documento inválido");
            return false;
        }

        // Verifica campos comuns de documentos brasileiros (OBRIGATÓRIO)
        var commonFields = new[]
        {
            "NOME",
            "NASCIMENTO",
            "NATURALIDADE",
            "FILIAÇÃO",
            "FILIACAO",
            "DATA",
            "ORGÃO",
            "ORGAO",
            "EXPEDIDOR",
            "ESTADO",
            "CIDADE",
            "MUNICIPIO",
            "MUNICÍPIO"
        };

        var foundFields = commonFields.Count(field => text.Contains(field));
        if (foundFields < 3) // Aumentado de 2 para 3 campos obrigatórios
        {
            flags.Add("campos_insuficientes");
            observacoes.Add($"❌ Poucos campos de documento detectados ({foundFields} de pelo menos 3) - documento inválido");
            return false; // Agora REJEITA se não tiver campos suficientes
        }

        _logger.LogInformation("✅ Validação RG/CNH: Indicadores encontrados: {Indicators}", string.Join(", ", foundIndicators));

        return true;
    }

    private async Task<AnalysisComponent> AnalyzeImageQualityAsync(string bucket, string fileName)
    {
        try
        {
            // Baixa a imagem para análise de metadados
            var getObjectRequest = new GetObjectRequest
            {
                BucketName = bucket,
                Key = fileName
            };

            using var response = await _s3Client.GetObjectAsync(getObjectRequest);
            using var memoryStream = new MemoryStream();
            await response.ResponseStream.CopyToAsync(memoryStream);
            var imageBytes = memoryStream.ToArray();

            var score = 0.0;
            var observacoes = new List<string>();
            var flags = new List<string>();

            // Verifica tamanho da imagem (imagens muito pequenas são suspeitas)
            if (imageBytes.Length < 50000) // < 50KB
            {
                flags.Add("imagem_pequena");
                observacoes.Add("⚠️ Imagem muito pequena (possível compressão excessiva)");
            }
            else
            {
                score += 5;
            }

            // Verifica se é uma imagem válida (tentativa básica)
            if (imageBytes.Length > 0)
            {
                score += 5;
            }

            return new AnalysisComponent
            {
                Score = score,
                Observacao = observacoes.Any() ? string.Join(" | ", observacoes) : null,
                Flags = flags
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Erro ao analisar qualidade da imagem");
            return new AnalysisComponent { Score = 0, Observacao = "Erro ao analisar qualidade", Flags = new List<string> { "erro_qualidade" } };
        }
    }

    private Task<AnalysisComponent> PerformFraudChecksAsync(
        string bucket,
        string fileName,
        AnalysisComponent faceAnalysis,
        AnalysisComponent textAnalysis)
    {
        var score = 0.0;
        var observacoes = new List<string>();
        var flags = new List<string>();

        // CRÍTICO: Se não é RG/CNH, rejeita imediatamente
        if (textAnalysis.Flags.Contains("nao_e_documento"))
        {
            flags.Add("fraude_nao_e_documento");
            observacoes.Add("🚨 CRÍTICO: Documento não é RG ou CNH válido");
            return Task.FromResult(new AnalysisComponent
            {
                Score = 0,
                Observacao = "🚨 Documento rejeitado: não é RG ou CNH válido",
                Flags = flags
            });
        }

        // Verifica flags críticas
        if (faceAnalysis.Flags.Contains("sem_face"))
        {
            flags.Add("fraude_sem_face");
            observacoes.Add("🚨 CRÍTICO: Nenhuma face detectada");
        }
        else
        {
            score += 5; // Documento tem face
        }

        if (textAnalysis.Flags.Contains("sem_texto") || textAnalysis.Flags.Contains("sem_cpf"))
        {
            flags.Add("fraude_sem_texto_cpf");
            observacoes.Add("🚨 CRÍTICO: Texto ou CPF não detectado");
        }
        else
        {
            score += 5; // Documento tem texto válido
        }

        // Combinação suspeita: múltiplas faces + pouco texto
        if (faceAnalysis.Flags.Contains("multiplas_faces") && textAnalysis.Flags.Contains("pouco_texto"))
        {
            flags.Add("fraude_combinacao_suspeita");
            observacoes.Add("🚨 Combinação suspeita detectada");
        }

        // Se não tem indicador de RG/CNH, rejeita
        if (textAnalysis.Flags.Contains("sem_indicador_rg_cnh"))
        {
            flags.Add("fraude_sem_indicador");
            observacoes.Add("🚨 CRÍTICO: Não encontrado indicador de RG ou CNH");
        }

        return Task.FromResult(new AnalysisComponent
        {
            Score = score,
            Observacao = observacoes.Any() ? string.Join(" | ", observacoes) : null,
            Flags = flags
        });
    }

    private class AnalysisComponent
    {
        public double Score { get; set; }
        public string? Observacao { get; set; }
        public List<string> Flags { get; set; } = new();
    }
}

