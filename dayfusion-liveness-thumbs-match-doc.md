# DayFusion – Fluxo Liveness com Thumbs + Match com Documento

> Arquivo pensado para **Angular 16+/19 + .NET 6/7/8** com AWS Rekognition.  
> Foco: usar o **Widget AWS Face Liveness** para capturar **vídeo + thumbs** e depois fazer **match com o documento (RG/CNH)**.

---

## 1. Objetivo do novo fluxo

1. Rodar o **Widget AWS Face Liveness** normalmente.
2. Ao finalizar a sessão, recuperar as **thumbnails (frames/audit images)** do liveness.
3. Usar essas thumbs para **comparar o rosto com a imagem do documento** (RG/CNH) via `CompareFaces`.
4. Gerar um **Score Final DayFusion** combinando:
   - Liveness (presença real)
   - Match com documento (mesma pessoa do documento)
5. Exibir tudo em um **segundo step dentro do mesmo modal** (UX limpa e contínua).

Fluxo alto nível:

```mermaid
flowchart TB
  A[Usuário clica em Iniciar Verificação] --> B[Widget AWS Face Liveness]
  B --> C[Resultado Liveness + Thumbs (S3)]
  C --> D[API DayFusion: Match Documento x Thumbs]
  D --> E[Etapa 2 Modal: Score + Imagens + Observações]
  E --> F[Salvar auditoria (DynamoDB / SQL) e finalizar]
```

---

## 2. Arquitetura Geral

### Frontend (Angular 19)

- Página: `FaceVerificationFlowComponent` (já criada no arquivo anterior).
- Etapa 1: `AwsLivenessStepComponent`
- Etapa 2: `CustomReviewStepComponent` (agora vai exibir **match com documento**).
- Service:
  - `AwsLivenessService` → inicia widget + devolve `sessionId`, `confidence`, `auditImages` (thumbs).
  - `FaceMatchService` (novo) → chama API backend para comparar documento x thumbs.

### Backend (.NET)

- Controller: `FaceVerificationController`
- Endpoint: `POST /api/face/match-from-liveness`
- Service: `FaceMatchService`
  - Chama AWS Rekognition `CompareFaces` para cada thumb.
  - Calcula melhor similaridade.
  - Retorna scores e detalhes para o front.

### AWS

- **Rekognition Face Liveness** (widget) → gera vídeo + audit images.
- **Rekognition CompareFaces** → match entre imagem do documento e thumbs.
- **S3** → armazena vídeo, thumbs e imagem do documento.
- (Opcional) **DynamoDB** → trilha de auditoria.

---

## 3. Modelo de dados no Frontend

### 3.1. Atualizar `LivenessResult`

```ts
// face-verification-flow.component.ts (mesmo arquivo anterior)
export interface AuditImageInfo {
  bucket: string;
  key: string;
  url?: string; // opcional – se você gerar URL assinado no backend
}

export interface LivenessResult {
  sessionId: string;
  confidenceScore: number;
  fraudScore?: number;
  auditImages?: AuditImageInfo[]; // 🔥 thumbs do liveness
  videoBucket?: string;
  videoKey?: string;
  raw?: any;
}
```

> O `AwsLivenessService` agora precisa popular `auditImages` com os dados que você tem no retorno do backend ou da chamada `GetFaceLivenessSessionResults`.

---

## 4. Angular – Chamar Match com Documento após o Liveness

### 4.1. Novo service `FaceMatchService` (frontend)

```ts
// core/services/face-match.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { LivenessResult } from '../../features/face-verification/face-verification-flow.component';

export interface MatchWithDocumentRequest {
  documentImageS3Path: string;  // ex.: s3://dayfusion-docs/cliente123/frente.jpg
  sessionId: string;
  auditImages: { bucket: string; key: string }[];
}

export interface MatchWithDocumentResponse {
  sessionId: string;
  livenessScore: number;
  bestMatchScore: number;
  bestMatchImageKey?: string;
  matches: {
    imageKey: string;
    similarity: number;
    confidence: number;
  }[];
  finalScore: number;
}

@Injectable({ providedIn: 'root' })
export class FaceMatchService {
  private baseUrl = '/api/face';

  constructor(private http: HttpClient) {}

  matchLivenessWithDocument(
    liveness: LivenessResult,
    documentImageS3Path: string
  ): Observable<MatchWithDocumentResponse> {
    const payload: MatchWithDocumentRequest = {
      documentImageS3Path,
      sessionId: liveness.sessionId,
      auditImages: (liveness.auditImages ?? []).map(a => ({
        bucket: a.bucket,
        key: a.key
      }))
    };

    return this.http.post<MatchWithDocumentResponse>(
      `${this.baseUrl}/match-from-liveness`,
      payload
    );
  }
}
```

> `documentImageS3Path` pode vir do seu fluxo de upload do documento (tela anterior).  
> Formato sugerido: `s3://bucket/key` ou dois campos (`bucket`, `key`).

---

## 5. Angular – Etapa 2: Review com Match

### 5.1. Ajustar `CustomReviewStepComponent` para chamar o match

```ts
// custom-review-step.component.ts
import { Component, EventEmitter, Input, Output, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LivenessResult } from '../../face-verification-flow.component';
import { FaceMatchService, MatchWithDocumentResponse } from '../../../../core/services/face-match.service';

@Component({
  selector: 'app-custom-review-step',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './custom-review-step.component.html',
  styleUrls: ['./custom-review-step.component.scss']
})
export class CustomReviewStepComponent implements OnInit {
  @Input() livenessResult!: LivenessResult;
  @Input() documentImageS3Path!: string; // 🔥 caminho da imagem do documento
  @Output() finished = new EventEmitter<void>();

  isLoadingMatch = false;
  isSaving = false;
  matchResult?: MatchWithDocumentResponse;
  observation = '';

  constructor(private faceMatchService: FaceMatchService) {}

  ngOnInit(): void {
    this.runMatch();
  }

  private runMatch() {
    if (!this.documentImageS3Path || !this.livenessResult.auditImages?.length) {
      return;
    }

    this.isLoadingMatch = true;

    this.faceMatchService
      .matchLivenessWithDocument(this.livenessResult, this.documentImageS3Path)
      .subscribe({
        next: res => {
          this.matchResult = res;
        },
        error: err => {
          console.error('Erro ao fazer match com documento', err);
        },
        complete: () => (this.isLoadingMatch = false)
      });
  }

  async confirm() {
    this.isSaving = true;
    try {
      // TODO: chamar API para salvar auditoria
      console.log('Salvar auditoria', {
        liveness: this.livenessResult,
        match: this.matchResult,
        observation: this.observation
      });
      this.finished.emit();
    } finally {
      this.isSaving = false;
    }
  }

  cancel() {
    this.finished.emit();
  }
}
```

### 5.2. HTML atualizado (match + thumbs)

```html
<!-- custom-review-step.component.html -->
<div class="review" *ngIf="livenessResult">
  <section class="review__left">
    <h3>Resumo da Verificação</h3>

    <div class="review__metrics">
      <div class="metric">
        <span class="metric__label">Session ID</span>
        <code>{{ livenessResult.sessionId }}</code>
      </div>

      <div class="metric">
        <span class="metric__label">Liveness Score</span>
        <span class="metric__value">
          {{ livenessResult.confidenceScore | number : '1.0-2' }}%
        </span>
      </div>

      <div class="metric" *ngIf="matchResult">
        <span class="metric__label">Match Documento</span>
        <span class="metric__value">
          {{ matchResult.bestMatchScore | number : '1.0-2' }}%
        </span>
      </div>

      <div class="metric" *ngIf="matchResult">
        <span class="metric__label">Score Final DayFusion</span>
        <span class="metric__value metric__value--final">
          {{ matchResult.finalScore | number : '1.0-2' }}%
        </span>
      </div>
    </div>

    <div class="review__obs">
      <label>Observações</label>
      <textarea
        [(ngModel)]="observation"
        rows="4"
        placeholder="Ex.: Liveness alto, match com documento consistente, sem sinais de deepfake...">
      </textarea>
    </div>
  </section>

  <section class="review__right">
    <h3>Imagens utilizadas</h3>

    <div class="review__thumbs-wrapper" *ngIf="livenessResult.auditImages?.length">
      <div class="review__thumbs">
        <div
          class="thumb"
          *ngFor="let img of livenessResult.auditImages">
          <!-- Se tiver URL assinado direto -->
          <img *ngIf="img.url" [src]="img.url" alt="Frame liveness" />

          <!-- Se estiver usando rota interna para servir imagens do S3 -->
          <img *ngIf="!img.url"
               [src]="'/api/media/liveness-frame?bucket=' + img.bucket + '&key=' + img.key"
               alt="Frame liveness" />
        </div>
      </div>

      <div class="review__doc">
        <h4>Documento</h4>
        <img
          [src]="'/api/media/document?path=' + documentImageS3Path"
          alt="Documento"
        />
      </div>
    </div>

    <div class="review__loading" *ngIf="isLoadingMatch">
      <span class="spinner"></span>
      <p>Calculando match do rosto com o documento...</p>
    </div>

    <div class="review__actions">
      <button class="btn-secondary" (click)="cancel()">Cancelar</button>
      <button class="btn-primary" (click)="confirm()" [disabled]="isSaving">
        {{ isSaving ? 'Salvando...' : 'Confirmar Verificação' }}
      </button>
    </div>
  </section>
</div>
```

---

## 6. Backend .NET – DTOs

```csharp
// Contracts/Requests/MatchFromLivenessRequest.cs
public class MatchFromLivenessRequest
{
    public string DocumentImageS3Path { get; set; } = default!; // "s3://bucket/key"
    public string SessionId { get; set; } = default!;

    public List<AuditImageDto> AuditImages { get; set; } = new();
}

public class AuditImageDto
{
    public string Bucket { get; set; } = default!;
    public string Key { get; set; } = default!;
}

// Contracts/Responses/MatchFromLivenessResponse.cs
public class MatchFromLivenessResponse
{
    public string SessionId { get; set; } = default!;
    public double LivenessScore { get; set; }
    public double BestMatchScore { get; set; }
    public string? BestMatchImageKey { get; set; }

    public List<MatchDetailDto> Matches { get; set; } = new();
    public double FinalScore { get; set; }
}

public class MatchDetailDto
{
    public string ImageKey { get; set; } = default!;
    public double Similarity { get; set; }
    public double Confidence { get; set; }
}
```

---

## 7. Backend .NET – Service de Match (Rekognition)

```csharp
// Services/FaceMatchService.cs
using Amazon.Rekognition;
using Amazon.Rekognition.Model;

public interface IFaceMatchService
{
    Task<MatchFromLivenessResponse> MatchFromLivenessAsync(
        MatchFromLivenessRequest request,
        double livenessScore);
}

public class FaceMatchService : IFaceMatchService
{
    private readonly IAmazonRekognition _rekognition;

    public FaceMatchService(IAmazonRekognition rekognition)
    {
        _rekognition = rekognition;
    }

    public async Task<MatchFromLivenessResponse> MatchFromLivenessAsync(
        MatchFromLivenessRequest request,
        double livenessScore)
    {
        var (docBucket, docKey) = ParseS3Path(request.DocumentImageS3Path);

        var matches = new List<MatchDetailDto>();
        double bestSimilarity = 0;
        string? bestKey = null;

        foreach (var auditImg in request.AuditImages)
        {
            var compareRequest = new CompareFacesRequest
            {
                SourceImage = new Image
                {
                    S3Object = new S3Object
                    {
                        Bucket = auditImg.Bucket,
                        Name = auditImg.Key
                    }
                },
                TargetImage = new Image
                {
                    S3Object = new S3Object
                    {
                        Bucket = docBucket,
                        Name = docKey
                    }
                },
                SimilarityThreshold = 70f
            };

            var compareResponse = await _rekognition.CompareFacesAsync(compareRequest);

            var bestFace = compareResponse.FaceMatches
                .OrderByDescending(f => f.Similarity)
                .FirstOrDefault();

            if (bestFace != null)
            {
                var similarity = bestFace.Similarity ?? 0;
                var confidence = bestFace.Face?.Confidence ?? 0;

                matches.Add(new MatchDetailDto
                {
                    ImageKey = auditImg.Key,
                    Similarity = similarity,
                    Confidence = confidence
                });

                if (similarity > bestSimilarity)
                {
                    bestSimilarity = similarity;
                    bestKey = auditImg.Key;
                }
            }
        }

        var finalScore = (livenessScore * 0.6) + (bestSimilarity * 0.4);

        return new MatchFromLivenessResponse
        {
            SessionId = request.SessionId,
            LivenessScore = livenessScore,
            BestMatchScore = bestSimilarity,
            BestMatchImageKey = bestKey,
            Matches = matches,
            FinalScore = finalScore
        };
    }

    private static (string Bucket, string Key) ParseS3Path(string s3Path)
    {
        if (!s3Path.StartsWith("s3://", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Formato inválido de caminho S3", nameof(s3Path));

        var withoutPrefix = s3Path.Substring("s3://".Length);
        var firstSlash = withoutPrefix.IndexOf('/');
        if (firstSlash < 0)
            throw new ArgumentException("Formato inválido de caminho S3", nameof(s3Path));

        var bucket = withoutPrefix.Substring(0, firstSlash);
        var key = withoutPrefix.Substring(firstSlash + 1);
        return (bucket, key);
    }
}
```

---

## 8. Backend .NET – Controller

```csharp
// Controllers/FaceVerificationController.cs
using Microsoft.AspNetCore.Mvc;

[ApiController]
[Route("api/face")]
public class FaceVerificationController : ControllerBase
{
    private readonly IFaceMatchService _faceMatchService;

    public FaceVerificationController(IFaceMatchService faceMatchService)
    {
        _faceMatchService = faceMatchService;
    }

    [HttpPost("match-from-liveness")]
    public async Task<ActionResult<MatchFromLivenessResponse>> MatchFromLiveness(
        [FromBody] MatchFromLivenessRequest request)
    {
        // TODO: recuperar livenessScore real via GetFaceLivenessSessionResults
        double livenessScore = 95.0; // placeholder – substituir pela leitura real

        var response = await _faceMatchService.MatchFromLivenessAsync(request, livenessScore);
        return Ok(response);
    }
}
```

---

## 9. Servir Imagens do S3 para o Front

```csharp
// Controllers/MediaController.cs
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.AspNetCore.Mvc;

[ApiController]
[Route("api/media")]
public class MediaController : ControllerBase
{
    private readonly IAmazonS3 _s3;

    public MediaController(IAmazonS3 s3)
    {
        _s3 = s3;
    }

    [HttpGet("liveness-frame")]
    public async Task<IActionResult> GetLivenessFrame([FromQuery] string bucket, [FromQuery] string key)
    {
        var response = await _s3.GetObjectAsync(bucket, key);
        return File(response.ResponseStream, response.Headers.ContentType ?? "image/jpeg");
    }

    [HttpGet("document")]
    public async Task<IActionResult> GetDocumentImage([FromQuery] string path)
    {
        var (bucket, key) = ParseS3Path(path);
        var response = await _s3.GetObjectAsync(bucket, key);
        return File(response.ResponseStream, response.Headers.ContentType ?? "image/jpeg");
    }

    private static (string Bucket, string Key) ParseS3Path(string s3Path)
    {
        var withoutPrefix = s3Path.Substring("s3://".Length);
        var firstSlash = withoutPrefix.IndexOf('/');
        var bucket = withoutPrefix[..firstSlash];
        var key = withoutPrefix[(firstSlash + 1)..];
        return (bucket, key);
    }
}
```

---

## 10. Checklist rápido

1. **Widget Liveness**
   - Ajustar `AwsLivenessService` para devolver `auditImages`.
2. **Front**
   - Passar `documentImageS3Path` para `CustomReviewStepComponent`.
   - Conferir chamada do `FaceMatchService`.
3. **Back**
   - Configurar `IAmazonRekognition` + `IAmazonS3`.
   - Testar `POST /api/face/match-from-liveness` e endpoints de mídia.
4. **UX**
   - Validar visualização de thumbs + documento + scores.
   - Ajustar thresholds para aprovado / revisão manual / reprovado.

Fim do arquivo.
