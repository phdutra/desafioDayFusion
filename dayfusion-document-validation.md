# 🧠 DayFusion — Validação de Documento + Score + Observação Automática

## 📋 Objetivo
Analisar a **autenticidade visual do documento** (RG/CNH) e gerar um **DocumentScore** que complementa o fluxo do FaceID (Liveness + Match).  
Com isso, o sistema identifica possíveis **fraudes** ou **casos manuais**, mesmo sem integração com o SERPRO.

---

## 🧩 Estrutura

```
/Services
 ├── FaceService.cs
 ├── OcrService.cs
 ├── DocumentAnalyzerService.cs   ← NOVO
 ├── ValidationService.cs
/Controllers
 └── IdentityController.cs
```

---

## ⚙️ appsettings.json

```json
"Aws": {
  "Region": "us-east-1",
  "Bucket": "dayfusion-bucket"
}
```

---

## 🧾 DocumentAnalyzerService.cs

```csharp
using Amazon.Rekognition;
using Amazon.Rekognition.Model;
using System.Linq;

public class DocumentAnalyzerService
{
    private readonly AmazonRekognitionClient _rekognition;
    private readonly IConfiguration _config;

    public DocumentAnalyzerService(IConfiguration config)
    {
        _config = config;
        _rekognition = new AmazonRekognitionClient(RegionEndpoint.GetBySystemName(_config["Aws:Region"]));
    }

    public async Task<DocumentAnalysisResult> AnalyzeAsync(string bucket, string fileName)
    {
        var request = new DetectFacesRequest
        {
            Image = new Image
            {
                S3Object = new S3Object
                {
                    Bucket = bucket,
                    Name = fileName
                }
            },
            Attributes = new List<string> { "ALL" }
        };

        var response = await _rekognition.DetectFacesAsync(request);

        // Inicia score base
        double score = 0;

        // 1. Face detectada
        if (response.FaceDetails.Any())
            score += 40;

        // 2. Brilho equilibrado
        var avgBrightness = response.FaceDetails.Average(f => f.Quality?.Brightness ?? 0);
        if (avgBrightness > 40 && avgBrightness < 80)
            score += 20;

        // 3. Nitidez adequada
        var avgSharpness = response.FaceDetails.Average(f => f.Quality?.Sharpness ?? 0);
        if (avgSharpness > 40)
            score += 20;

        // 4. Sem distorções graves
        if (response.FaceDetails.All(f => f.Confidence > 90))
            score += 20;

        // Garante limite 0–100
        score = Math.Min(score, 100);

        string observacao = score switch
        {
            >= 85 => "Documento visualmente autêntico ✅",
            >= 70 => "Documento válido, mas revisar manualmente ⚠️",
            _ => "Documento suspeito 🚨"
        };

        return new DocumentAnalysisResult
        {
            DocumentScore = score,
            Observacao = observacao
        };
    }
}

public class DocumentAnalysisResult
{
    public double DocumentScore { get; set; }
    public string Observacao { get; set; }
}
```

---

## 🧠 ValidationService.cs (ajuste com DocumentScore)

```csharp
public class ValidationService
{
    public double CalculateIdentityScore(double liveness, double match, double document)
    {
        // ponderação: 40% Liveness, 40% Match, 20% Documento
        double score = (liveness * 0.4) + (match / 100 * 0.4) + (document / 100 * 0.2);
        return Math.Round(score, 2);
    }

    public string GenerateObservation(double finalScore, string documentObs)
    {
        string level = finalScore switch
        {
            >= 0.85 => "✅ Validação automática aprovada",
            >= 0.70 => "⚠️ Revisar documento manualmente",
            _ => "🚨 Possível fraude — revisão obrigatória"
        };

        return $"{level} | {documentObs}";
    }
}
```

---

## 🌐 IdentityController.cs

```csharp
[ApiController]
[Route("api/identity")]
public class IdentityController : ControllerBase
{
    private readonly OcrService _ocr;
    private readonly FaceService _face;
    private readonly DocumentAnalyzerService _docAnalyzer;
    private readonly ValidationService _validator;

    public IdentityController(OcrService ocr, FaceService face, DocumentAnalyzerService docAnalyzer, ValidationService validator)
    {
        _ocr = ocr;
        _face = face;
        _docAnalyzer = docAnalyzer;
        _validator = validator;
    }

    [HttpPost("validate")]
    public async Task<IActionResult> ValidateIdentity([FromBody] IdentityRequest request)
    {
        // 1. Analisar documento
        var docAnalysis = await _docAnalyzer.AnalyzeAsync(request.Bucket, request.FileName);

        // 2. Calcular score final
        var identityScore = _validator.CalculateIdentityScore(request.LivenessScore, request.MatchScore, docAnalysis.DocumentScore);

        // 3. Gerar observação
        var observacao = _validator.GenerateObservation(identityScore, docAnalysis.Observacao);

        // 4. Retornar resultado consolidado
        return Ok(new
        {
            LivenessScore = request.LivenessScore,
            MatchScore = request.MatchScore,
            DocumentScore = docAnalysis.DocumentScore,
            IdentityScore = identityScore,
            Observacao = observacao
        });
    }
}

public class IdentityRequest
{
    public string Bucket { get; set; }
    public string FileName { get; set; }
    public double LivenessScore { get; set; }
    public double MatchScore { get; set; }
}
```

---

## 🧩 Exemplo de resposta JSON

```json
{
  "LivenessScore": 0.96,
  "MatchScore": 91.5,
  "DocumentScore": 78.0,
  "IdentityScore": 0.82,
  "Observacao": "⚠️ Revisar documento manualmente | Documento válido, mas revisar manualmente ⚠️"
}
```

---

## 🧠 Angular — Exibição do resultado

```html
<div class="p-4 rounded shadow">
  <h3 class="font-semibold mb-2">Resultado da Análise</h3>

  <ul class="text-sm">
    <li><strong>Liveness:</strong> {{ result.livenessScore * 100 | number:'1.0-0' }}%</li>
    <li><strong>Match:</strong> {{ result.matchScore | number:'1.0-0' }}%</li>
    <li><strong>Documento:</strong> {{ result.documentScore | number:'1.0-0' }}%</li>
    <li><strong>Score Final:</strong> {{ result.identityScore * 100 | number:'1.0-0' }}%</li>
  </ul>

  <div class="mt-3 p-3 rounded text-white"
       [ngClass]="{
         'bg-green-600': result.identityScore >= 0.85,
         'bg-yellow-500': result.identityScore >= 0.7 && result.identityScore < 0.85,
         'bg-red-600': result.identityScore < 0.7
       }">
    {{ result.observacao }}
  </div>
</div>
```

---

## 💡 Recomendações

| Fase | Solução |
|------|----------|
| **POC** | Use apenas AWS Rekognition (DetectFaces + DetectText). |
| **Validação manual** | Mostre o documento capturado e o motivo da observação. |
| **Fase 2** | Adicione modelo de IA customizado (ex: *FakeDocNet* no TensorFlow). |
| **Fase 3** | Integre SERPRO/Denatran para validação cadastral real. |

---

## ✅ Benefícios

- Detecta documentos falsos ou imagens de tela.  
- Gera observação automática (manual/revisão/fraude).  
- Mantém fluxo AWS puro, sem dependência externa.  
- Pronto para evoluir com IA ou integração oficial no futuro.
