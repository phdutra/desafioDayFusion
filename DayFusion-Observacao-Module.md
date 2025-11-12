# DayFusion — Módulo de Observação & Justificativa (Angular 19 + .NET 8 + AWS)

> **Objetivo:** adicionar ao DayFusion uma camada de **observação/justificativa** para cada sessão de verificação (aprovada ou rejeitada), com registro auditável, edição por administradores e métricas agregadas.

---

## 🔧 Arquitetura Rápida

- **Front (Angular 19):**
  - Páginas: `Verificações` (lista) e `Detalhes` (modal com imagens/scores e campo “Observação”).
  - Serviços: `verification.service.ts` (REST), `observation.service.ts` (REST).
  - Guard: `admin.guard.ts` (só admin acessa o painel).

- **Back (.NET 8 Web API):**
  - Endpoints REST para listar/ver, salvar observação, alterar status e consultar métricas.
  - Persistência **AWS DynamoDB** (recomendado) — opção EF Core/SQL incluída.
  - Logs no CloudWatch (via Serilog opcional).

- **Storage & Segurança:**
  - Imagens/Vídeos em S3 (somente leitura segura via link pré-assinado no painel).
  - **LGPD:** observações livres de dados sensíveis (motivos técnicos/operacionais).

---

## 📦 Estrutura de Dados (DynamoDB)

**Tabela:** `DayFusion-Analysis` (sessão por verificação)

**PartitionKey (PK):** `SessionId` (string, ex: `b123-456-xyz`)  
**SortKey (SK):** `TYPE#ANALYSIS` (fixo; facilita GSI/expansões)  

**Atributos principais:**
```json
{
  "SessionId": "b123-456-xyz",
  "UserId": "abc-001",
  "Status": "REJECTED",              // APPROVED | REJECTED | REVIEW_REQUIRED
  "MatchScore": 72,
  "LivenessScore": 88,
  "FraudScore": 15,
  "AutoObservations": [
    "Rosto não corresponde ao documento",
    "Documento fora do enquadramento"
  ],
  "ManualObservation": "Imagem escura; solicitar nova captura",
  "Media": {
    "SelfieUrl": "s3://.../selfie.jpg",
    "DocumentUrl": "s3://.../doc.jpg"
  },
  "DeviceInfo": "Mozilla/5.0; platform=Mac",
  "CreatedAt": "2025-11-11T20:00:00Z",
  "ReviewedBy": "admin@dayfusion.com",
  "ReviewedAt": "2025-11-11T20:10:00Z"
}
```

**TTL opcional:** `ExpireAt` (epoch seconds) p/ retenção mínima (privacidade).

### CloudFormation (exemplo rápido)
```yaml
Resources:
  DayFusionAnalysisTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: DayFusion-Analysis
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - AttributeName: SessionId
          AttributeType: S
        - AttributeName: SK
          AttributeType: S
      KeySchema:
        - AttributeName: SessionId
          KeyType: HASH
        - AttributeName: SK
          KeyType: RANGE
      TimeToLiveSpecification:
        AttributeName: ExpireAt
        Enabled: true
```

---

## 🔐 IAM — Permissões (mínimas para o módulo)

**Role da API (.NET)**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DynamoDBAccess",
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:UpdateItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ],
      "Resource": "arn:aws:dynamodb:REGION:ACCOUNT_ID:table/DayFusion-Analysis"
    },
    {
      "Sid": "S3SignedUrls",
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": "arn:aws:s3:::DAYFUSION_BUCKET/*"
    }
  ]
}
```

> **Nota:** link de mídia no painel deve ser **pré-assinado** via API (nunca expor caminho público).

---

## ⚙️ Backend (.NET 8 Web API)

### 1) `appsettings.json`
```json
{
  "AWS": {
    "Region": "us-east-1"
  },
  "DynamoDb": {
    "TableName": "DayFusion-Analysis"
  },
  "S3": {
    "Bucket": "dayfusion-media"
  },
  "Auth": {
    "JwtAuthority": "https://cognito-idp.us-east-1.amazonaws.com/POOL_ID",
    "RequiredRole": "admin"
  }
}
```

### 2) Program.cs (essencial)
```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddAWSService<Amazon.DynamoDBv2.IAmazonDynamoDB>();
builder.Services.AddSingleton<Amazon.DynamoDBv2.DataModel.DynamoDBContext>();

builder.Services.AddControllers();

// (Opcional) JWT + Policy "AdminOnly"
builder.Services.AddAuthentication("Bearer")
    .AddJwtBearer("Bearer", options =>
    {
        options.Authority = builder.Configuration["Auth:JwtAuthority"];
        options.TokenValidationParameters.ValidateAudience = false;
    });

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("AdminOnly", policy =>
    {
        policy.RequireClaim("cognito:groups", builder.Configuration["Auth:RequiredRole"]);
    });
});

var app = builder.Build();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.Run();
```

### 3) DTOs
```csharp
public record AnalysisDto(
    string SessionId,
    string UserId,
    string Status,
    int MatchScore,
    int LivenessScore,
    int FraudScore,
    IEnumerable<string> AutoObservations,
    string? ManualObservation,
    string SelfieSignedUrl,
    string DocumentSignedUrl,
    string CreatedAt,
    string? ReviewedBy,
    string? ReviewedAt
);

public record SaveObservationRequest(string ManualObservation);

public record UpdateStatusRequest(string Status); // APPROVED | REJECTED | REVIEW_REQUIRED
```

### 4) Model DynamoDB
```csharp
[DynamoDBTable("DayFusion-Analysis")]
public class AnalysisEntity
{
    [DynamoDBHashKey] public string SessionId { get; set; } = default!;
    [DynamoDBRangeKey] public string SK { get; set; } = "TYPE#ANALYSIS";
    public string UserId { get; set; } = default!;
    public string Status { get; set; } = "REVIEW_REQUIRED";
    public int MatchScore { get; set; }
    public int LivenessScore { get; set; }
    public int FraudScore { get; set; }
    public List<string> AutoObservations { get; set; } = new();
    public string? ManualObservation { get; set; }
    public string? SelfieKey { get; set; }
    public string? DocumentKey { get; set; }
    public string CreatedAt { get; set; } = DateTime.UtcNow.ToString("O");
    public string? ReviewedBy { get; set; }
    public string? ReviewedAt { get; set; }
    public long? ExpireAt { get; set; } // TTL
}
```

### 5) Repositório (DynamoDBContext)
```csharp
public interface IAnalysisRepository
{
    Task<AnalysisEntity?> GetAsync(string sessionId);
    Task UpsertAsync(AnalysisEntity entity);
    Task<IEnumerable<AnalysisEntity>> ListAsync(int limit = 50);
}

public class AnalysisRepository : IAnalysisRepository
{
    private readonly DynamoDBContext _ctx;

    public AnalysisRepository(DynamoDBContext ctx) => _ctx = ctx;

    public async Task<AnalysisEntity?> GetAsync(string sessionId)
        => await _ctx.LoadAsync<AnalysisEntity>(sessionId, "TYPE#ANALYSIS");

    public async Task UpsertAsync(AnalysisEntity entity)
        => await _ctx.SaveAsync(entity);

    public async Task<IEnumerable<AnalysisEntity>> ListAsync(int limit = 50)
    {
        var conditions = new List<ScanCondition>();
        var search = _ctx.ScanAsync<AnalysisEntity>(conditions, new DynamoDBOperationConfig { });
        var results = new List<AnalysisEntity>();
        do
        {
            var page = await search.GetNextSetAsync();
            results.AddRange(page);
        } while (!search.IsDone && results.Count < limit);
        return results.Take(limit);
    }
}
```

### 6) Controller
```csharp
[ApiController]
[Route("api/verifications")]
public class VerificationsController : ControllerBase
{
    private readonly IAnalysisRepository _repo;
    private readonly IAmazonS3 _s3;
    private readonly IConfiguration _cfg;

    public VerificationsController(IAnalysisRepository repo, IAmazonS3 s3, IConfiguration cfg)
    {
        _repo = repo; _s3 = s3; _cfg = cfg;
    }

    [HttpGet]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> List() => Ok(await _repo.ListAsync());

    [HttpGet("{sessionId}")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> Get(string sessionId)
    {
        var e = await _repo.GetAsync(sessionId);
        if (e is null) return NotFound();

        string bucket = _cfg["S3:Bucket"]!;
        string signedSelfie = await SignAsync(bucket, e.SelfieKey);
        string signedDoc = await SignAsync(bucket, e.DocumentKey);

        var dto = new AnalysisDto(
            e.SessionId, e.UserId, e.Status, e.MatchScore, e.LivenessScore, e.FraudScore,
            e.AutoObservations, e.ManualObservation, signedSelfie, signedDoc, e.CreatedAt,
            e.ReviewedBy, e.ReviewedAt
        );
        return Ok(dto);
    }

    [HttpPost("{sessionId}/observation")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> SaveObservation(string sessionId, [FromBody] SaveObservationRequest body)
    {
        var e = await _repo.GetAsync(sessionId);
        if (e is null) return NotFound();

        e.ManualObservation = body.ManualObservation;
        e.ReviewedBy = User?.Identity?.Name ?? "admin";
        e.ReviewedAt = DateTime.UtcNow.ToString("O");
        await _repo.UpsertAsync(e);
        return NoContent();
    }

    [HttpPatch("{sessionId}/status")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> UpdateStatus(string sessionId, [FromBody] UpdateStatusRequest body)
    {
        var e = await _repo.GetAsync(sessionId);
        if (e is null) return NotFound();
        e.Status = body.Status;
        await _repo.UpsertAsync(e);
        return NoContent();
    }

    private async Task<string> SignAsync(string bucket, string? key)
    {
        if (string.IsNullOrWhiteSpace(bucket) || string.IsNullOrWhiteSpace(key)) return string.Empty;
        var req = new GetPreSignedUrlRequest
        {
            BucketName = bucket,
            Key = key,
            Expires = DateTime.UtcNow.AddMinutes(10)
        };
        return _s3.GetPreSignedURL(req);
    }
}
```

> **NuGets necessários**: `AWSSDK.DynamoDBv2`, `AWSSDK.S3`, `Amazon.Extensions.NETCore.Setup`.

> **Alternativa EF/SQL**: trocar `AnalysisRepository` por `DbContext` EF Core e mapear `AnalysisEntity` como tabela relacional.

---

## 🖥️ Front-end (Angular 19)

### 1) Modelos
`src/app/core/models/analysis.ts`
```ts
export interface Analysis {
  sessionId: string;
  userId: string;
  status: 'APPROVED' | 'REJECTED' | 'REVIEW_REQUIRED';
  matchScore: number;
  livenessScore: number;
  fraudScore: number;
  autoObservations: string[];
  manualObservation?: string;
  selfieSignedUrl?: string;
  documentSignedUrl?: string;
  createdAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
}
```

### 2) Services
`src/app/core/services/verification.service.ts`
```ts
import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Analysis } from '../models/analysis';

@Injectable({ providedIn: 'root' })
export class VerificationService {
  private base = '/api/verifications';

  constructor(private http: HttpClient) {}

  list() {
    return this.http.get<Analysis[]>(`${this.base}`);
  }

  get(sessionId: string) {
    return this.http.get<Analysis>(`${this.base}/${sessionId}`);
  }

  saveObservation(sessionId: string, manualObservation: string) {
    return this.http.post<void>(`${this.base}/${sessionId}/observation`, { manualObservation });
  }

  updateStatus(sessionId: string, status: Analysis['status']) {
    return this.http.patch<void>(`${this.base}/${sessionId}/status`, { status });
  }
}
```

### 3) Guard (somente admin)
`src/app/core/guards/admin.guard.ts`
```ts
import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';

@Injectable({ providedIn: 'root' })
export class AdminGuard implements CanActivate {
  constructor(private router: Router) {}

  canActivate(): boolean {
    const isAdmin = localStorage.getItem('df:isAdmin') === 'true';
    if (!isAdmin) {
      this.router.navigateByUrl('/');
      return false;
    }
    return true;
  }
}
```

> **Produção:** substituir por validação real via Cognito/JWT claims (grupo `admin`).

### 4) Página de Lista
`src/app/features/verifications/verifications-list.component.ts`
```ts
import { Component, OnInit } from '@angular/core';
import { VerificationService } from '../../core/services/verification.service';
import { Analysis } from '../../core/models/analysis';

@Component({
  selector: 'df-verifications-list',
  standalone: true,
  templateUrl: './verifications-list.component.html'
})
export class VerificationsListComponent implements OnInit {
  items: Analysis[] = [];
  loading = false;

  constructor(private api: VerificationService) {}

  ngOnInit() {
    this.refresh();
  }

  refresh() {
    this.loading = true;
    this.api.list().subscribe({
      next: data => { this.items = data; this.loading = false; },
      error: _ => this.loading = false
    });
  }
}
```

`src/app/features/verifications/verifications-list.component.html`
```html
<div class="p-4">
  <h2 class="text-xl font-semibold mb-3">Verificações</h2>
  <button class="btn" (click)="refresh()">Recarregar</button>

  <table class="table w-full mt-3">
    <thead>
      <tr>
        <th>Sessão</th><th>Status</th><th>Score</th><th>Observação</th><th>Ações</th>
      </tr>
    </thead>
    <tbody>
      <tr *ngFor="let x of items">
        <td>{{ x.sessionId }}</td>
        <td [class]="x.status === 'APPROVED' ? 'text-green-600' : (x.status === 'REJECTED' ? 'text-red-600' : 'text-yellow-600')">
          {{ x.status }}
        </td>
        <td>{{ x.matchScore }}%</td>
        <td>
          {{ x.manualObservation || (x.autoObservations?.[0] || '-') }}
        </td>
        <td>
          <a [routerLink]="['/verifications', x.sessionId]" class="link">Detalhes</a>
        </td>
      </tr>
    </tbody>
  </table>
</div>
```

### 5) Página de Detalhes + Observação
`src/app/features/verifications/verification-detail.component.ts`
```ts
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { VerificationService } from '../../core/services/verification.service';
import { Analysis } from '../../core/models/analysis';

@Component({
  selector: 'df-verification-detail',
  standalone: true,
  templateUrl: './verification-detail.component.html'
})
export class VerificationDetailComponent implements OnInit {
  item?: Analysis;
  sessionId!: string;
  saving = false;
  newObservation = '';

  constructor(private route: ActivatedRoute, private api: VerificationService) {}

  ngOnInit() {
    this.sessionId = this.route.snapshot.params['sessionId'];
    this.load();
  }

  load() {
    this.api.get(this.sessionId).subscribe(x => {
      this.item = x;
      this.newObservation = x.manualObservation || '';
    });
  }

  saveObservation() {
    if (!this.newObservation?.trim()) return;
    this.saving = true;
    this.api.saveObservation(this.sessionId, this.newObservation).subscribe({
      next: () => { this.saving = false; this.load(); },
      error: () => { this.saving = false; }
    });
  }

  setStatus(status: Analysis['status']) {
    this.api.updateStatus(this.sessionId, status).subscribe(() => this.load());
  }
}
```

`src/app/features/verifications/verification-detail.component.html`
```html
<div class="p-4" *ngIf="item as x">
  <h2 class="text-xl font-semibold mb-3">Sessão {{ x.sessionId }}</h2>

  <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
    <div class="col-span-2">
      <div class="mb-2">
        <strong>Status:</strong>
        <span [class]="x.status === 'APPROVED' ? 'text-green-600' : (x.status === 'REJECTED' ? 'text-red-600' : 'text-yellow-600')">
          {{ x.status }}
        </span>
      </div>
      <div class="mb-2">
        <strong>Scores:</strong>
        Match {{ x.matchScore }}% · Liveness {{ x.livenessScore }}% · Fraud {{ x.fraudScore }}%
      </div>
      <div class="mb-4">
        <strong>Auto:</strong> {{ x.autoObservations?.join(' · ') || '-' }}
      </div>

      <label class="block mb-1 font-medium">Observação (manual)</label>
      <textarea [(ngModel)]="newObservation" rows="4" class="textarea w-full" placeholder="Ex.: Imagem escura; solicitar nova captura"></textarea>
      <div class="mt-2 flex gap-2">
        <button class="btn" (click)="saveObservation()" [disabled]="saving">Salvar</button>
        <button class="btn btn-success" (click)="setStatus('APPROVED')">Aprovar</button>
        <button class="btn btn-error" (click)="setStatus('REJECTED')">Reprovar</button>
      </div>
    </div>

    <div>
      <div class="mb-2"><strong>Selfie</strong></div>
      <img *ngIf="x.selfieSignedUrl" [src]="x.selfieSignedUrl" class="w-full rounded shadow" />
      <div class="mt-4 mb-2"><strong>Documento</strong></div>
      <img *ngIf="x.documentSignedUrl" [src]="x.documentSignedUrl" class="w-full rounded shadow" />
    </div>
  </div>
</div>
```

### 6) Rotas
`src/app/app.routes.ts`
```ts
import { Routes } from '@angular/router';
import { VerificationsListComponent } from './features/verifications/verifications-list.component';
import { VerificationDetailComponent } from './features/verifications/verification-detail.component';
import { AdminGuard } from './core/guards/admin.guard';

export const routes: Routes = [
  { path: 'verifications', component: VerificationsListComponent, canActivate: [AdminGuard] },
  { path: 'verifications/:sessionId', component: VerificationDetailComponent, canActivate: [AdminGuard] }
];
```

### 7) Estilo rápido (opcional, Tailwind/DaisyUI)
- Use classes utilitárias como mostrado nos templates HTML.
- Manter o **mesmo estilo do seu menu atual** (ajuste as classes para seu design system).

---

## 🤖 Regras de Observação Automática (exemplos)

- `MatchScore < 75` → “Rosto não corresponde ao documento”  
- `LivenessScore < 80` → “Falha na verificação de presença (movimento insuficiente)”  
- `FraudScore > 60` → “Indícios de manipulação de imagem”  
- `OCR incompleto` → “Documento ilegível; recapturar em boa iluminação”  
- `Documento fora do quadro` → “Reposicionar e capturar novamente”

Implementar como função no backend (antes de salvar a entidade):
```csharp
static IEnumerable<string> BuildAutoObservations(AnalysisEntity e) {
    var list = new List<string>();
    if (e.MatchScore < 75) list.Add("Rosto não corresponde ao documento");
    if (e.LivenessScore < 80) list.Add("Falha na verificação de presença (movimento insuficiente)");
    if (e.FraudScore > 60) list.Add("Indícios de manipulação de imagem");
    return list;
}
```

---

## 🔒 LGPD & Compliance (boas práticas)

- **Consentimento explícito** antes da captura.
- **Retenção mínima** com TTL (ex.: 24–72h).
- **Criptografia**: S3 (AES-256) e tráfego HTTPS.
- **Pseudonimização**: evite dados pessoais em observações livres.
- **Auditoria**: registre `ReviewedBy/ReviewedAt` em toda mudança.

---

## 🧪 Testes rápidos (checklist)

- [ ] Criar tabela `DayFusion-Analysis` (DynamoDB).  
- [ ] Configurar `appsettings.json` e IAM da API.  
- [ ] Subir API e validar endpoints via Postman.  
- [ ] Injetar links pré-assinados das mídias.  
- [ ] Criar rota `/verifications` no Angular e testar listagem.  
- [ ] Abrir detalhe, salvar observação, aprovar/reprovar.  
- [ ] Validar que somente admin acessa o painel.  
- [ ] Conferir logs no CloudWatch.

---

## ▶️ Execução

**API (.NET 8):**
```bash
dotnet add package AWSSDK.DynamoDBv2
dotnet add package AWSSDK.S3
dotnet add package Amazon.Extensions.NETCore.Setup

dotnet run
```

**Angular 19:**
```bash
npm i
ng serve -o
```

> Ajuste `baseUrl` do `HttpClient` (proxy ou `environment.ts`) para apontar para sua API.

---

## 📈 Métricas (endpoint opcional)

`GET /api/verifications/metrics` → retorna agregados por período:
```json
{
  "total": 120,
  "approved": 74,
  "rejected": 34,
  "reviewRequired": 12,
  "avgMatchScore": 81,
  "rejectionReasonsTop": [
    { "reason": "Rosto não corresponde ao documento", "count": 18 },
    { "reason": "Documento ilegível", "count": 9 }
  ]
}
```

---

## ✅ Resultado

- Camada de **observação auditável** (auto + manual).  
- **Painel admin** para revisão e justificativa.  
- **Pronto para produção** com LGPD, TTL e link pré-assinado de mídia.

---

**Dúvidas comuns**
- *Posso usar SQL em vez de DynamoDB?* Sim; troque o repositório por EF Core.  
- *Como habilitar o isAdmin real?* Leia `cognito:groups` do JWT e implemente `AdminOnly`.  
- *Como exibir vídeo?* Gere URL pré-assinada de `mp4` no S3 e use `<video controls>` no detalhe.

Boa construção! 💪
