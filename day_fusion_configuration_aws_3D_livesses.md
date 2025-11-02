2) Backend (.NET 8) – endpoints prontos
appsettings.json
"AWS": {
  "Region": "us-east-1",
  "S3Bucket": "dayfusion-bucket"
}

Startup/Program – clientes AWS com fallback de credenciais
builder.Services.AddSingleton<IAmazonS3>(_ =>
{
    var region = RegionEndpoint.USEast1; // appsettings se preferir
    var creds = FallbackCredentialsFactory.GetCredentials(); // pega env vars/~/.aws/credentials/IMDS
    return new AmazonS3Client(creds, region);
});

builder.Services.AddSingleton<IAmazonRekognition>(_ =>
{
    var region = RegionEndpoint.USEast1;
    var creds = FallbackCredentialsFactory.GetCredentials();
    return new AmazonRekognitionClient(creds, region);
});

Controller – cria sessão (devolve sessionId)
[HttpPost("liveness/session")]
public async Task<IActionResult> CreateSession(
    [FromServices] IAmazonRekognition rek)
{
    var req = new CreateFaceLivenessSessionRequest
    {
        Settings = new LivenessSessionSettings
        {
            AuditImagesLimit = 4,
            ChallengePreferences = new List<LivenessSessionChallenge>{
                new LivenessSessionChallenge {
                    FaceMovementAndLightChallenge = new FaceMovementAndLightServerChallenge{}
                }
            }
        }
        // Opcional: OutputConfig para salvar direto em S3
        // OutputConfig = new LivenessOutputConfig { S3Bucket = "dayfusion-bucket", S3KeyPrefix = "liveness/raw" }
    };

    var resp = await rek.CreateFaceLivenessSessionAsync(req);
    return Ok(new { sessionId = resp.SessionId });
}

Controller – busca resultados, salva imagens no S3
[HttpGet("liveness/results")]
public async Task<IActionResult> GetResults(
    [FromQuery] string sessionId,
    [FromServices] IAmazonRekognition rek,
    [FromServices] IAmazonS3 s3,
    [FromConfiguration] IConfiguration cfg)
{
    if (string.IsNullOrWhiteSpace(sessionId)) return BadRequest("sessionId obrigatório.");

    var res = await rek.GetFaceLivenessSessionResultsAsync(new GetFaceLivenessSessionResultsRequest
    {
        SessionId = sessionId
    });

    // Salva imagens no S3 (Reference + Audit)
    var bucket = cfg["AWS:S3Bucket"]!;
    var prefix = $"liveness/{sessionId}";

    // Reference image
    string? referenceKey = null;
    if (res.ReferenceImage != null && res.ReferenceImage.Bytes != null)
    {
        referenceKey = $"{prefix}/reference.jpg";
        await s3.PutObjectAsync(new PutObjectRequest{
            BucketName = bucket,
            Key = referenceKey,
            InputStream = new MemoryStream(res.ReferenceImage.Bytes.ToArray()),
            ContentType = "image/jpeg"
        });
    }

    var auditKeys = new List<string>();
    if (res.AuditImages != null)
    {
        int i = 0;
        foreach (var img in res.AuditImages)
        {
            var key = $"{prefix}/audit_{i++}.jpg";
            await s3.PutObjectAsync(new PutObjectRequest{
                BucketName = bucket,
                Key = key,
                InputStream = new MemoryStream(img.Bytes.ToArray()),
                ContentType = "image/jpeg"
            });
            auditKeys.Add(key);
        }
    }

    return Ok(new {
        sessionId,
        confidence = res.Confidence,     // score do liveness (ex.: 99.28)
        referenceImageKey = referenceKey,
        auditImageKeys = auditKeys
    });
}


Dica: Se quiser que a própria AWS grave as imagens automaticamente, use OutputConfig no CreateFaceLivenessSessionRequest. Eu preferi salvar manualmente para você ter as chaves e controle.

3) Frontend (Angular) – usando o FaceLivenessDetector como Web Component

O UI Liveness oficial é React. A forma estável hoje para Angular é criar um micro-componente React com o FaceLivenessDetector, expor como Custom Element e usar no Angular (tag HTML).

3.1 Criar micro-app React (na pasta liveness-widget/)
npm create vite@latest liveness-widget -- --template react
cd liveness-widget
npm i aws-amplify @aws-amplify/ui-react-liveness
npm i --save-dev vite-plugin-svgr


src/main.jsx (registrando como Web Component):

import React from 'react'
import ReactDOM from 'react-dom/client'
import { defineCustomElement } from 'react-to-webcomponent'
import FaceLivenessWidget from './widget.jsx'

customElements.define('face-liveness-widget', defineCustomElement(FaceLivenessWidget, React, ReactDOM))


src/widget.jsx (o componente em si):

import { useEffect, useState } from 'react'
import { FaceLivenessDetector } from '@aws-amplify/ui-react-liveness'
import { Amplify } from 'aws-amplify'

// O elemento recebe atributos HTML (region, createSessionUrl, resultsUrl)
export default function Widget() {
  const [sessionId, setSessionId] = useState(null)

  useEffect(() => {
    const el = document.currentScript?.ownerDocument?.currentScript || document.querySelector('face-liveness-widget')
    const region = el?.getAttribute('region') || 'us-east-1'
    const createUrl = el?.getAttribute('create-session-url') // ex.: /api/liveness/session
    const resultsUrl = el?.getAttribute('results-url') // ex.: /api/liveness/results

    Amplify.configure({ Auth: { region } })

    fetch(createUrl, { method: 'POST' })
      .then(r => r.json())
      .then(d => setSessionId(d.sessionId))
  }, [])

  if (!sessionId) return <div>Loading...</div>

  return (
    <FaceLivenessDetector
      sessionId={sessionId}
      region="us-east-1"
      onAnalysisComplete={async () => {
        // chama seu backend para buscar resultados e salvar as imagens no S3
        await fetch(`/api/liveness/results?sessionId=${sessionId}`)
      }}
      onError={(e) => console.error(e)}
    />
  )
}


Build:

npm run build


Isso gera um bundle (ex.: dist/assets/*.js) que registra o custom element <face-liveness-widget>.

3.2 Usar no Angular

Copie o bundle gerado para src/assets/liveness/ do Angular.

No index.html do Angular, carregue o script:

<script src="/assets/liveness/widget.js"></script>


Onde quiser usar:

<face-liveness-widget
  region="us-east-1"
  create-session-url="/api/liveness/session"
  results-url="/api/liveness/results">
</face-liveness-widget>


Pronto: o Angular hospeda a UI React do Liveness como Web Component, mantendo sua app Angular intacta.

4) O que você recebe e como usar

Confiança (confidence): score do liveness (ex.: 99.28). Você define seu threshold (ex.: ≥ 80 aprova).

ReferenceImage + AuditImages: salvos no S3 nas chaves que retornei (liveness/{sessionId}/...).
Você pode exibir no Review da sua SPA (GET assinado do S3) e persistir a chave na sua tabela de transações (Dynamo).


Program.cs (mínimo funcional)

using Amazon;
using Amazon.Rekognition;
using Amazon.S3;
using Amazon.DynamoDBv2;
using Amazon.Runtime;
using Microsoft.AspNetCore.Mvc;

var builder = WebApplication.CreateBuilder(args);

var region = RegionEndpoint.GetBySystemName(builder.Configuration["AWS:Region"] ?? "us-east-1");

// Credenciais: tenta de ambiente/perfil (~/.aws/credentials)
AWSCredentials creds = FallbackCredentialsFactory.GetCredentials();

builder.Services.AddSingleton<IAmazonRekognition>(_ => new AmazonRekognitionClient(creds, region));
builder.Services.AddSingleton<IAmazonS3>(_ => new AmazonS3Client(creds, region));
builder.Services.AddSingleton<IAmazonDynamoDB>(_ => new AmazonDynamoDBClient(creds, region));

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();
app.UseSwagger();
app.UseSwaggerUI();
app.MapControllers();
app.Run();


Models/CompareRequest.cs

public record CompareRequest(string SessionId, string DocumentKey);


Controllers/StorageController.cs – upload do documento

using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.AspNetCore.Mvc;

[ApiController]
[Route("api/document")]
public class StorageController : ControllerBase
{
    private readonly IAmazonS3 _s3;
    private readonly IConfiguration _cfg;
    public StorageController(IAmazonS3 s3, IConfiguration cfg){ _s3 = s3; _cfg = cfg; }

    [HttpPost("upload")]
    public async Task<IActionResult> Upload(IFormFile file)
    {
        if (file is null || file.Length == 0) return BadRequest("Arquivo vazio");

        var bucket = _cfg["AWS:S3Bucket"]!;
        var key = $"documents/{Guid.NewGuid()}/{file.FileName}";

        await _s3.PutObjectAsync(new PutObjectRequest {
            BucketName = bucket,
            Key = key,
            InputStream = file.OpenReadStream(),
            ContentType = file.ContentType
        });

        return Ok(new {
            documentKey = key,
            url = $"https://{bucket}.s3.amazonaws.com/{key}"
        });
    }
}


Controllers/LivenessController.cs – cria sessão + compara

using Amazon.Rekognition;
using Amazon.Rekognition.Model;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.AspNetCore.Mvc;

[ApiController]
[Route("api/liveness")]
public class LivenessController : ControllerBase
{
    private readonly IAmazonRekognition _rek;
    private readonly IAmazonS3 _s3;
    private readonly IConfiguration _cfg;

    public LivenessController(IAmazonRekognition rek, IAmazonS3 s3, IConfiguration cfg)
    { _rek = rek; _s3 = s3; _cfg = cfg; }

    [HttpPost("session")]
    public async Task<IActionResult> CreateSession()
    {
        var resp = await _rek.CreateFaceLivenessSessionAsync(new CreateFaceLivenessSessionRequest
        {
            Settings = new LivenessSessionSettings
            {
                AuditImagesLimit = 4,
                ChallengePreferences = new List<LivenessSessionChallenge> {
                    new() { FaceMovementAndLightChallenge = new FaceMovementAndLightServerChallenge() }
                }
            }
        });
        return Ok(new { sessionId = resp.SessionId });
    }

    [HttpPost("compare")]
    public async Task<IActionResult> Compare([FromBody] CompareRequest req)
    {
        // 1) Resultado de Liveness (pega a ReferenceImage "viva")
        var result = await _rek.GetFaceLivenessSessionResultsAsync(
            new GetFaceLivenessSessionResultsRequest { SessionId = req.SessionId });

        if (result.Confidence < 70)
            return Ok(new { status="reprovado", reason="Liveness baixo", liveness=result.Confidence });

        // 2) Salva ReferenceImage em S3
        var bucket = _cfg["AWS:S3Bucket"]!;
        var refKey = $"liveness/{req.SessionId}/reference.jpg";
        await _s3.PutObjectAsync(new PutObjectRequest {
            BucketName = bucket,
            Key = refKey,
            InputStream = new MemoryStream(result.ReferenceImage.Bytes.ToArray()),
            ContentType = "image/jpeg"
        });

        // 3) Compara referência (source) com documento (target)
        var cmp = await _rek.CompareFacesAsync(new CompareFacesRequest {
            SourceImage = new Image { S3Object = new Amazon.Rekognition.Model.S3Object { Bucket = bucket, Name = refKey } },
            TargetImage = new Image { S3Object = new Amazon.Rekognition.Model.S3Object { Bucket = bucket, Name = req.DocumentKey } },
            SimilarityThreshold = 80f
        });

        var match = cmp.FaceMatches.FirstOrDefault();
        var similarity = match?.Similarity ?? 0f;
        var status = (similarity >= 80 && result.Confidence >= 70) ? "aprovado" : "reprovado";

        return Ok(new {
            status,
            liveness = result.Confidence,
            similarity,
            referenceKey = refKey,
            documentKey = req.DocumentKey
        });
    }
}


Build & Run

dotnet restore
dotnet run
# Swagger: http://localhost:5000/swagger

4) Frontend (Angular 19)
Rotina típica do componente

Upload do documento

uploadDoc(file: File) {
  const fd = new FormData();
  fd.append('file', file);
  this.http.post<any>('/api/document/upload', fd)
    .subscribe(r => this.documentKey = r.documentKey);
}


Criar sessão de Liveness

startSession() {
  this.http.post<any>('/api/liveness/session', {})
    .subscribe(r => this.sessionId = r.sessionId);
}


Executar Liveness 3D
Você precisa acoplar o SDK Web do Rekognition Face Liveness (widget web).

Se estiver usando o SDK web/React da AWS, ele recebe o sessionId e faz o fluxo (WebRTC).

Ao concluir, chame:

finalizarComparacao() {
  this.http.post<any>('/api/liveness/compare', {
    sessionId: this.sessionId,
    documentKey: this.documentKey
  }).subscribe(r => this.result = r);
}


Exibir resultado

<div *ngIf="result">
  <h3>Status: {{result.status | uppercase}}</h3>
  <p>Liveness: {{result.liveness | number:'1.0-2'}}%</p>
  <p>Similarity: {{result.similarity | number:'1.0-2'}}%</p>
</div>


💡 Sobre o SDK Web do Liveness (front):
A AWS fornece um componente web/React que encapsula o fluxo WebRTC e coleta o resultado da sessão (a ReferenceImage fica disponível via GetFaceLivenessSessionResults no backend).
Se preferir não usar o SDK web oficial, você pode substituir temporariamente por uma selfie 2D capturada no browser (padrão <video> + <canvas>) apenas para demonstrar a comparação — mas isso não é Liveness 3D.

5) DynamoDB (opcional – log/audit)

Crie a tabela (se ainda não existe):

aws dynamodb create-table \
  --table-name dayfusion_transactions \
  --attribute-definitions AttributeName=TransactionId,AttributeType=S \
  --key-schema AttributeName=TransactionId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1


No endpoint compare, você pode gravar um item:

// Exemplo (adicione onde quiser)
using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
// ...
var db = HttpContext.RequestServices.GetRequiredService<IAmazonDynamoDB>();
var item = new Dictionary<string, AttributeValue> {
  ["TransactionId"] = new AttributeValue(Guid.NewGuid().ToString()),
  ["SessionId"] = new AttributeValue(req.SessionId),
  ["DocumentKey"] = new AttributeValue(req.DocumentKey),
  ["Liveness"] = new AttributeValue { N = result.Confidence.ToString("F2") },
  ["Similarity"] = new AttributeValue { N = similarity.ToString("F2") },
  ["Status"] = new AttributeValue(status),
  ["CreatedAt"] = new AttributeValue(DateTime.UtcNow.ToString("o"))
};
await db.PutItemAsync("dayfusion_transactions", item);

6) Teste de ponta a ponta

aws configure (perfil default ok)

Verificar permissões (S3, Rekognition, DynamoDB)

Rodar API → http://localhost:5000/swagger

Angular:

Upload do documento → recebe documentKey

Criar sessão → recebe sessionId

Executar Liveness no browser (SDK web)

Chamar /liveness/compare → retorna status/liveness/similarity

7) Diagnóstico rápido

403 no PUT S3: CORS/bucket policy/credenciais

SignatureDoesNotMatch: URL pré-assinada v2 (evite) ou headers extras; use apenas Content-Type

Credentials must be specified: API sem perfil/env vars – confira ~/.aws/credentials

AccessDenied dynamodb:DescribeTable: faltou política no IAM

Liveness baixo: ambiente escuro, sem movimento correto, câmera ruim

8) Roadmap (nice to have)

Extração automática da foto do documento (OCR + crop) via Textract/Custom Vision

Anti-fraude: detecção de apresentação (tela, máscara, foto impressa) com regras adicionais

Versionamento de limiares (ex.: Liveness ≥ 85 e Similarity ≥ 90) por tipo de produto/risco

Auditoria: salvar audit images/hash dos arquivos

9) Estrutura sugerida
/dayfusion
  /frontend    (Angular 19)
  /api         (.NET 8 Web API)
  /infra
    /iam       (json de políticas)
    /scripts   (CLI úteis)
  README.md
