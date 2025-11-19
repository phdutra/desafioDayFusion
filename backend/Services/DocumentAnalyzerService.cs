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
        var startTime = DateTime.UtcNow;
        try
        {
            _logger.LogInformation("🔍 [DIAGNÓSTICO] Iniciando análise de texto OCR. Bucket: {Bucket}, FileName: {FileName}, Timestamp: {Timestamp}", 
                bucket, fileName, startTime);
            
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

            _logger.LogInformation("📤 [DIAGNÓSTICO] Enviando requisição DetectText para AWS Rekognition. Bucket: {Bucket}, Key: {Key}", 
                bucket, fileName);
            
            var response = await _rekognition.DetectTextAsync(request);
            
            var duration = (DateTime.UtcNow - startTime).TotalMilliseconds;
            _logger.LogInformation("✅ [DIAGNÓSTICO] Resposta recebida do AWS Rekognition. Duração: {Duration}ms, TextDetections: {Count}", 
                duration, response.TextDetections?.Count ?? 0);
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

            // Log detalhado do texto detectado
            _logger.LogInformation("📝 [DIAGNÓSTICO] Texto detectado no documento:");
            _logger.LogInformation("   - Total de detecções: {Count}", textDetections.Count);
            _logger.LogInformation("   - Linhas: {LineCount}", textDetections.Count(t => t.Type == TextTypes.LINE));
            _logger.LogInformation("   - Palavras: {WordCount}", textDetections.Count(t => t.Type == TextTypes.WORD));
            _logger.LogInformation("   - Texto completo (primeiros 500 chars): {Text}", 
                allText.Length > 500 ? allText.Substring(0, 500) + "..." : allText);
            _logger.LogInformation("   - Confiança média: {AvgConfidence:F2}%", 
                textDetections.Any() ? textDetections.Average(t => t.Confidence ?? 0) : 0);

            // Validação crítica: verifica se é RG ou CNH
            var isRgOrCnh = ValidateRgOrCnh(allTextUpper, out var validationFlags, out var validationObs);
            
            _logger.LogInformation("📊 [DIAGNÓSTICO] Resultado da validação RG/CNH: {IsValid}, Flags: [{Flags}], Observações: [{Obs}]", 
                isRgOrCnh, string.Join(", ", validationFlags), string.Join(" | ", validationObs));
            
            if (!isRgOrCnh)
            {
                flags.AddRange(validationFlags);
                flags.Add("nao_e_documento");
                observacoes.AddRange(validationObs);
                
                _logger.LogWarning("⚠️ [DIAGNÓSTICO] Documento rejeitado na validação RG/CNH. Flags: [{Flags}]", string.Join(", ", flags));
                
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
        catch (Amazon.Rekognition.Model.InvalidImageFormatException ex)
        {
            var duration = (DateTime.UtcNow - startTime).TotalMilliseconds;
            _logger.LogError(ex, "❌ [DIAGNÓSTICO] Formato de imagem inválido para OCR. Bucket: {Bucket}, FileName: {FileName}, Duração: {Duration}ms, ErrorCode: {ErrorCode}, StatusCode: {StatusCode}, Message: {Message}", 
                bucket, fileName, duration, ex.ErrorCode, ex.StatusCode, ex.Message);
            
            return new AnalysisComponent 
            { 
                Score = 0, 
                Observacao = $"Erro ao analisar texto: Formato de imagem inválido ({ex.Message})", 
                Flags = new List<string> { "erro_texto", "formato_invalido" }
            };
        }
        catch (Amazon.Rekognition.Model.ImageTooLargeException ex)
        {
            var duration = (DateTime.UtcNow - startTime).TotalMilliseconds;
            _logger.LogError(ex, "❌ [DIAGNÓSTICO] Imagem muito grande para OCR. Bucket: {Bucket}, FileName: {FileName}, Duração: {Duration}ms, ErrorCode: {ErrorCode}, StatusCode: {StatusCode}, Message: {Message}", 
                bucket, fileName, duration, ex.ErrorCode, ex.StatusCode, ex.Message);
            
            return new AnalysisComponent 
            { 
                Score = 0, 
                Observacao = $"Erro ao analisar texto: Imagem muito grande ({ex.Message})", 
                Flags = new List<string> { "erro_texto", "imagem_muito_grande" }
            };
        }
        catch (Amazon.Rekognition.Model.ProvisionedThroughputExceededException ex)
        {
            var duration = (DateTime.UtcNow - startTime).TotalMilliseconds;
            _logger.LogError(ex, "❌ [DIAGNÓSTICO] Limite de throughput do Rekognition excedido. Bucket: {Bucket}, FileName: {FileName}, Duração: {Duration}ms, ErrorCode: {ErrorCode}, StatusCode: {StatusCode}, Message: {Message}", 
                bucket, fileName, duration, ex.ErrorCode, ex.StatusCode, ex.Message);
            
            return new AnalysisComponent 
            { 
                Score = 0, 
                Observacao = $"Erro ao analisar texto: Limite de requisições excedido (tente novamente)", 
                Flags = new List<string> { "erro_texto", "limite_excedido" }
            };
        }
        catch (Amazon.Runtime.AmazonServiceException ex)
        {
            var duration = (DateTime.UtcNow - startTime).TotalMilliseconds;
            _logger.LogError(ex, "❌ [DIAGNÓSTICO] Erro do AWS Rekognition ao analisar texto. Bucket: {Bucket}, FileName: {FileName}, Duração: {Duration}ms, ErrorCode: {ErrorCode}, StatusCode: {StatusCode}, RequestId: {RequestId}, Message: {Message}, InnerException: {InnerException}", 
                bucket, fileName, duration, ex.ErrorCode, ex.StatusCode, ex.RequestId, ex.Message, ex.InnerException?.Message ?? "N/A");
            
            // Log detalhes adicionais se disponíveis (apenas para exceções específicas do Rekognition)
            if (ex is Amazon.Rekognition.Model.InvalidImageFormatException ||
                ex is Amazon.Rekognition.Model.ImageTooLargeException ||
                ex is Amazon.Rekognition.Model.ProvisionedThroughputExceededException)
            {
                _logger.LogError("   - Detalhes adicionais da exceção Rekognition disponíveis");
            }
            
            return new AnalysisComponent 
            { 
                Score = 0, 
                Observacao = $"Erro ao analisar texto: {ex.ErrorCode} - {ex.Message}", 
                Flags = new List<string> { "erro_texto", $"rekognition_{ex.ErrorCode?.ToLowerInvariant() ?? "erro"}" }
            };
        }
        catch (System.Threading.Tasks.TaskCanceledException ex)
        {
            var duration = (DateTime.UtcNow - startTime).TotalMilliseconds;
            _logger.LogError(ex, "❌ [DIAGNÓSTICO] Timeout ao analisar texto no documento. Bucket: {Bucket}, FileName: {FileName}, Duração: {Duration}ms, Message: {Message}, InnerException: {InnerException}", 
                bucket, fileName, duration, ex.Message, ex.InnerException?.Message ?? "N/A");
            
            return new AnalysisComponent 
            { 
                Score = 0, 
                Observacao = "Erro ao analisar texto: Timeout na requisição (tente novamente)", 
                Flags = new List<string> { "erro_texto", "timeout" }
            };
        }
        catch (System.Net.Http.HttpRequestException ex)
        {
            var duration = (DateTime.UtcNow - startTime).TotalMilliseconds;
            _logger.LogError(ex, "❌ [DIAGNÓSTICO] Erro de conectividade ao analisar texto. Bucket: {Bucket}, FileName: {FileName}, Duração: {Duration}ms, Message: {Message}, InnerException: {InnerException}", 
                bucket, fileName, duration, ex.Message, ex.InnerException?.Message ?? "N/A");
            
            return new AnalysisComponent 
            { 
                Score = 0, 
                Observacao = "Erro ao analisar texto: Problema de conectividade com AWS", 
                Flags = new List<string> { "erro_texto", "conectividade" }
            };
        }
        catch (Exception ex)
        {
            var duration = (DateTime.UtcNow - startTime).TotalMilliseconds;
            _logger.LogError(ex, "❌ [DIAGNÓSTICO] Erro inesperado ao analisar texto no documento. Bucket: {Bucket}, FileName: {FileName}, Duração: {Duration}ms, Tipo: {ExceptionType}, Message: {Message}, StackTrace: {StackTrace}, InnerException: {InnerException}", 
                bucket, fileName, duration, ex.GetType().FullName, ex.Message, ex.StackTrace, ex.InnerException?.Message ?? "N/A");
            
            // Log inner exception completo se houver
            if (ex.InnerException != null)
            {
                _logger.LogError("   - InnerException Tipo: {InnerType}, Message: {InnerMessage}, StackTrace: {InnerStackTrace}", 
                    ex.InnerException.GetType().FullName, ex.InnerException.Message, ex.InnerException.StackTrace);
            }
            
            // Não rejeita imediatamente por erro - pode ser problema temporário do OCR
            // Retorna score baixo mas não marca como "nao_e_documento" para permitir revisão manual
            return new AnalysisComponent 
            { 
                Score = 0, 
                Observacao = $"Erro ao analisar texto: {ex.GetType().Name} - {ex.Message}", 
                Flags = new List<string> { "erro_texto" } // Removido "nao_e_documento" para permitir revisão
            };
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

        _logger.LogInformation("🔍 [DIAGNÓSTICO] Busca de indicadores RG/CNH:");
        _logger.LogInformation("   - Indicadores RG encontrados: {HasRg}", hasRgKeyword);
        _logger.LogInformation("   - Indicadores CNH encontrados: {HasCnh}", hasCnhKeyword);
        _logger.LogInformation("   - Palavras-chave RG testadas: {RgKeywords}", string.Join(", ", rgKeywords));
        _logger.LogInformation("   - Palavras-chave CNH testadas: {CnhKeywords}", string.Join(", ", cnhKeywords));

        if (!hasRgKeyword && !hasCnhKeyword)
        {
            flags.Add("sem_indicador_rg_cnh");
            observacoes.Add("❌ Não encontrado indicador de RG ou CNH");
            _logger.LogWarning("⚠️ [DIAGNÓSTICO] Nenhum indicador RG/CNH encontrado no texto");
            return false;
        }

        if (hasRgKeyword) foundIndicators.Add("RG");
        if (hasCnhKeyword) foundIndicators.Add("CNH");

        // Verifica CPF (obrigatório em ambos)
        var cpfPattern = @"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b"; // Formato: 123.456.789-00 ou 12345678900
        var hasCpf = System.Text.RegularExpressions.Regex.IsMatch(text, cpfPattern);
        
        _logger.LogInformation("🔍 [DIAGNÓSTICO] Busca de CPF:");
        _logger.LogInformation("   - CPF com formato padrão: {HasCpf}", hasCpf);
        
        if (!hasCpf)
        {
            // Tenta padrão mais flexível (apenas números)
            var cpfNumbersOnly = System.Text.RegularExpressions.Regex.Matches(text, @"\d{11}");
            _logger.LogInformation("   - Sequências de 11 dígitos encontradas: {Count}", cpfNumbersOnly.Count);
            
            if (cpfNumbersOnly.Count == 0)
            {
                // Tenta padrão ainda mais flexível: qualquer sequência de 9-11 dígitos
                var flexibleNumbers = System.Text.RegularExpressions.Regex.Matches(text, @"\d{9,11}");
                _logger.LogInformation("   - Sequências de 9-11 dígitos encontradas: {Count}", flexibleNumbers.Count);
                
                if (flexibleNumbers.Count == 0)
                {
                    flags.Add("sem_cpf");
                    observacoes.Add("❌ CPF não encontrado no documento");
                    _logger.LogWarning("⚠️ [DIAGNÓSTICO] CPF não encontrado em nenhum formato");
                    return false;
                }
                // Se encontrou 9-11 dígitos, considera válido (pode ser CPF com OCR imperfeito)
                foundIndicators.Add("CPF (possível - formato flexível)");
                _logger.LogInformation("   ✅ CPF encontrado em formato flexível");
            }
            else
            {
                // Se encontrou 11 dígitos, considera válido (pode ser CPF)
                foundIndicators.Add("CPF (possível)");
                _logger.LogInformation("   ✅ CPF encontrado em formato numérico");
            }
        }
        else
        {
            foundIndicators.Add("CPF");
            _logger.LogInformation("   ✅ CPF encontrado em formato padrão");
        }

        // Verifica se tem texto suficiente (documentos reais têm muito texto)
        var wordCount = text.Split(new[] { ' ', '\n', '\t' }, StringSplitOptions.RemoveEmptyEntries).Length;
        _logger.LogInformation("🔍 [DIAGNÓSTICO] Análise de quantidade de texto:");
        _logger.LogInformation("   - Total de palavras: {WordCount}", wordCount);
        _logger.LogInformation("   - Limite mínimo: 10 palavras");
        
        // Reduzido de 15 para 10 palavras (mais flexível)
        if (wordCount < 10)
        {
            flags.Add("texto_insuficiente");
            observacoes.Add($"❌ Texto insuficiente ({wordCount} palavras) - documento inválido");
            _logger.LogWarning("⚠️ [DIAGNÓSTICO] Texto insuficiente: {WordCount} palavras (mínimo: 10)", wordCount);
            return false;
        }
        
        _logger.LogInformation("   ✅ Quantidade de texto suficiente");

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
        var foundFieldsList = commonFields.Where(field => text.Contains(field)).ToList();
        
        _logger.LogInformation("🔍 [DIAGNÓSTICO] Análise de campos do documento:");
        _logger.LogInformation("   - Campos encontrados: {Count} de {Total}", foundFields, commonFields.Length);
        _logger.LogInformation("   - Campos detectados: [{Fields}]", string.Join(", ", foundFieldsList));
        _logger.LogInformation("   - Limite mínimo: 2 campos");
        
        // Reduzido de 3 para 2 campos obrigatórios (mais flexível)
        if (foundFields < 2)
        {
            flags.Add("campos_insuficientes");
            observacoes.Add($"❌ Poucos campos de documento detectados ({foundFields} de pelo menos 2) - documento inválido");
            _logger.LogWarning("⚠️ [DIAGNÓSTICO] Campos insuficientes: {Found} campos encontrados (mínimo: 2)", foundFields);
            return false;
        }
        
        _logger.LogInformation("   ✅ Campos suficientes encontrados");

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

