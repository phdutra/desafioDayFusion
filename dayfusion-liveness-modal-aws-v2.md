# DayFusion – Modal Customizado + AWS Face Liveness (V2)

Guia completo para integrar **modal custom (Angular 19)** com o **widget oficial AWS Rekognition Face Liveness (V2)**, incluindo backend (.NET), permissões AWS e checklist de testes.

---

## 1. Visão Geral da Arquitetura

Fluxo resumido:

1. Usuário abre o **seu modal customizado** (Angular).
2. O frontend chama o **backend .NET** para criar uma **sessão de liveness** (`CreateLivenessSession`).
3. O backend chama a **API AWS Rekognition Face Liveness** e retorna o `SessionId` para o frontend.
4. O frontend inicializa o **widget AWS V2** dentro do seu modal customizado, usando o `SessionId` e a `region`.
5. O widget faz toda a captura 3D, WebRTC e antifraude.
6. Ao finalizar, o widget dispara o `onComplete` no frontend com o `sessionId` e o resultado básico.
7. O backend chama `GetFaceLivenessSessionResults` para obter o `ConfidenceScore` e o `Status` definitivos.
8. Os resultados são armazenados no **DynamoDB** e os vídeos/imagens no **S3** (opcional, dependendo da sua arquitetura).

> Importante: o **modal é custom**, mas a **captura 3D e antifraude sempre é do widget AWS**.

---

## 2. Configuração AWS

### 2.1. Serviços envolvidos

- **Amazon Rekognition Face Liveness**
- **Amazon Cognito (Identity Pool)** – para credenciais temporárias no frontend
- **IAM Role do Identity Pool** – com permissões Rekognition
- **(Opcional) DynamoDB** – auditoria da sessão
- **(Opcional) S3** – armazenamento de mídia

### 2.2. Permissões IAM (Role do Identity Pool)

Na role de execução ligada ao **Cognito Identity Pool** usado pelo frontend, inclua a política:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "rekognition:StartFaceLivenessSession",
        "rekognition:GetFaceLivenessSessionResults"
      ],
      "Resource": "*"
    }
  ]
}
```

Se o backend também for chamar `StartFaceLivenessSession`, inclua as mesmas ações na role da aplicação (EC2, ECS, Lambda ou IAM User usado pelo .NET).

---

## 3. Backend (.NET) – Endpoints de Liveness

### 3.1. Pacotes necessários

No seu projeto .NET (6 ou superior):

```bash
dotnet add package AWSSDK.Rekognition
dotnet add package AWSSDK.Core
```

### 3.2. Configurações (appsettings.json)

```json
{
  "AWS": {
    "Region": "us-east-1",
    "AccessKey": "SEU_ACCESS_KEY_OPCIONAL_SE_USAR_PROFILE",
    "SecretKey": "SEU_SECRET_KEY_OPCIONAL_SE_USAR_PROFILE"
  },
  "DayFusion": {
    "LivenessRegion": "us-east-1"
  }
}
```

Se estiver rodando em ambiente com **role associada** (EC2/ECS/Lambda), você pode omitir `AccessKey` e `SecretKey` e usar apenas a região.

### 3.3. Serviço de Liveness

```csharp
using Amazon;
using Amazon.Rekognition;
using Amazon.Rekognition.Model;

public interface ILivenessService
{
    Task<string> CreateLivenessSessionAsync();
    Task<GetFaceLivenessSessionResultsResponse> GetLivenessResultAsync(string sessionId);
}

public class LivenessService : ILivenessService
{
    private readonly IAmazonRekognition _rekognition;
    private readonly string _region;

    public LivenessService(IConfiguration configuration)
    {
        _region = configuration["DayFusion:LivenessRegion"] ?? "us-east-1";
        var regionEndpoint = RegionEndpoint.GetBySystemName(_region);
        _rekognition = new AmazonRekognitionClient(regionEndpoint);
    }

    public async Task<string> CreateLivenessSessionAsync()
    {
        var request = new StartFaceLivenessSessionRequest
        {
            // Opcional: configurar parâmetro de timeout, etc.
        };

        var response = await _rekognition.StartFaceLivenessSessionAsync(request);
        return response.SessionId;
    }

    public async Task<GetFaceLivenessSessionResultsResponse> GetLivenessResultAsync(string sessionId)
    {
        var request = new GetFaceLivenessSessionResultsRequest
        {
            SessionId = sessionId
        };

        var response = await _rekognition.GetFaceLivenessSessionResultsAsync(request);
        return response;
    }
}
```

### 3.4. Controller Web API

```csharp
[ApiController]
[Route("api/[controller]")]
public class LivenessController : ControllerBase
{
    private readonly ILivenessService _livenessService;

    public LivenessController(ILivenessService livenessService)
    {
        _livenessService = livenessService;
    }

    [HttpPost("create-session")]
    public async Task<IActionResult> CreateSession()
    {
        var sessionId = await _livenessService.CreateLivenessSessionAsync();
        return Ok(new { sessionId });
    }

    [HttpGet("result/{sessionId}")]
    public async Task<IActionResult> GetResult(string sessionId)
    {
        var result = await _livenessService.GetLivenessResultAsync(sessionId);

        // Mapeando para um DTO simples
        var dto = new
        {
            sessionId = result.SessionId,
            confidence = result.Confidence,
            status = result.Status.ToString(),
            auditInfo = new
            {
                createdAt = DateTime.UtcNow
            }
        };

        return Ok(dto);
    }
}
```

### 3.5. Registro no `Program.cs`

```csharp
builder.Services.AddSingleton<ILivenessService, LivenessService>();
```

---

## 4. Frontend Angular 19 – Integração com Widget V2

### 4.1. Script e CSS do Widget (index.html)

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>DayFusion</title>
    <base href="/" />

    <!-- Widget AWS Face Liveness V2 -->
    <script src="https://assets.face-liveness.aws.dev/v2/face-liveness.js"></script>
    <link rel="stylesheet" href="https://assets.face-liveness.aws.dev/v2/face-liveness.css" />
  </head>
  <body>
    <app-root></app-root>
  </body>
</html>
```

> Não use URLs antigas ou de CloudFront manual – use sempre o domínio oficial `assets.face-liveness.aws.dev`.

---

### 4.2. Serviço Angular para Liveness (chamada ao backend)

`src/app/services/liveness.service.ts`:

```ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class LivenessService {
  private baseUrl = '/api/liveness'; // ajuste conforme seu backend

  constructor(private http: HttpClient) {}

  createSession(): Observable<{ sessionId: string }> {
    return this.http.post<{ sessionId: string }>(`${this.baseUrl}/create-session`, {});
  }

  getResult(sessionId: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/result/${sessionId}`);
  }
}
```

---

### 4.3. Modal Customizado – HTML

`src/app/components/liveness-modal/liveness-modal.component.html`:

```html
<div class="modal-overlay" *ngIf="visible">
  <div class="modal-container">
    <header class="modal-header">
      <h2>Verificação de Prova de Vida</h2>
      <button type="button" (click)="close()">×</button>
    </header>

    <section class="modal-body">
      <p class="description">
        Olhe para a câmera e siga as instruções na tela. O processo leva apenas alguns segundos.
      </p>

      <!-- Container onde o widget AWS será renderizado -->
      <div id="liveness-widget-container"></div>

      <div class="status" *ngIf="statusMessage">
        {{ statusMessage }}
      </div>
    </section>
  </div>
</div>
```

---

### 4.4. Modal Customizado – SCSS (exemplo simples)

`src/app/components/liveness-modal/liveness-modal.component.scss`:

```scss
.modal-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  z-index: 9999;
}

.modal-container {
  width: 100%;
  max-width: 480px;
  background: #05040a;
  border-radius: 16px;
  padding: 16px 20px 24px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
  color: #f5f5f5;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;

  h2 {
    font-size: 1.2rem;
    margin: 0;
  }

  button {
    border: none;
    background: transparent;
    color: #ccc;
    cursor: pointer;
    font-size: 1.4rem;
  }
}

.modal-body {
  .description {
    font-size: 0.9rem;
    margin-bottom: 8px;
    color: #ccc;
  }

  #liveness-widget-container {
    width: 100%;
    height: 360px;
    border-radius: 12px;
    overflow: hidden;
    background: #000;
  }

  .status {
    margin-top: 8px;
    font-size: 0.8rem;
    color: #9fef00;
  }
}
```

---

### 4.5. Modal Customizado – TypeScript (integração com widget)

`src/app/components/liveness-modal/liveness-modal.component.ts`:

```ts
import {
  Component,
  AfterViewInit,
  Input,
  OnDestroy
} from '@angular/core';
import { LivenessService } from '../../services/liveness.service';

declare const FaceLiveness: any; // vindo do script global

@Component({
  selector: 'app-liveness-modal',
  templateUrl: './liveness-modal.component.html',
  styleUrls: ['./liveness-modal.component.scss']
})
export class LivenessModalComponent implements AfterViewInit, OnDestroy {
  @Input() visible = false;

  statusMessage = '';
  private widgetInstance: any;
  private sessionId: string | null = null;
  private region = 'us-east-1';

  constructor(private livenessService: LivenessService) {}

  ngAfterViewInit(): void {
    if (this.visible) {
      this.startLivenessFlow();
    }
  }

  ngOnDestroy(): void {
    this.destroyWidget();
  }

  // Chamado pelo componente pai quando abrir o modal
  public open(): void {
    this.visible = true;
    this.statusMessage = 'Iniciando verificação...';
    this.startLivenessFlow();
  }

  public close(): void {
    this.visible = false;
    this.statusMessage = '';
    this.destroyWidget();
  }

  private destroyWidget(): void {
    if (this.widgetInstance && typeof this.widgetInstance.destroy === 'function') {
      this.widgetInstance.destroy();
    }
    this.widgetInstance = null;
  }

  private startLivenessFlow(): void {
    // Passo 1: criar sessão no backend
    this.livenessService.createSession().subscribe({
      next: ({ sessionId }) => {
        this.sessionId = sessionId;
        this.statusMessage = 'Sessão criada. Carregando câmera...';
        this.initWidget(sessionId);
      },
      error: (err) => {
        console.error('[Liveness] Erro ao criar sessão:', err);
        this.statusMessage = 'Erro ao iniciar a verificação.';
      }
    });
  }

  private initWidget(sessionId: string): void {
    const container = document.getElementById('liveness-widget-container');

    if (!container) {
      console.error('[Liveness] Container do widget não encontrado.');
      return;
    }

    this.destroyWidget();

    try {
      this.widgetInstance = new FaceLiveness({
        sessionId,
        region: this.region,
        preset: 'faceMovementAndLight', // conforme doc da AWS
        onError: (err: any) => {
          console.error('[Liveness] Erro widget:', err);
          this.statusMessage = 'Erro na captura. Tente novamente.';
        },
        onComplete: (result: any) => {
          console.log('[Liveness] Resultado parcial (frontend):', result);
          this.statusMessage = 'Processando resultado...';
          if (this.sessionId) {
            this.fetchFinalResult(this.sessionId);
          }
        }
      });

      this.widgetInstance.render(container);
    } catch (err) {
      console.error('[Liveness] Erro ao inicializar widget:', err);
      this.statusMessage = 'Não foi possível iniciar a câmera.';
    }
  }

  private fetchFinalResult(sessionId: string): void {
    this.livenessService.getResult(sessionId).subscribe({
      next: (result) => {
        console.log('[Liveness] Resultado final (backend):', result);
        const confidence = result.confidence ?? 0;
        this.statusMessage = `Verificação concluída. Confiança: ${confidence.toFixed(2)}%`;
      },
      error: (err) => {
        console.error('[Liveness] Erro ao buscar resultado:', err);
        this.statusMessage = 'Erro ao obter resultado da verificação.';
      }
    });
  }
}
```

> Observação: aqui o modal é controlado pelo próprio componente. No seu projeto você pode controlar `visible` pelo componente pai, chamando `@ViewChild(LivenessModalComponent) modal; modal.open();`.

---

## 5. Evitando o Erro “CREATED / UNKNOWN / Timeout 60 tentativas”

Se você ver no console algo como:

- `status: "CREATED"` repetindo várias vezes
- `decision: "UNKNOWN"`
- `confidence: 0`
- `AWS timeout após 60 tentativas. Usando fallback (score local).`

Verifique:

1. **Widget V2 carregado corretamente**
   - Confirme se o script é `https://assets.face-liveness.aws.dev/v2/face-liveness.js`.
   - Não use URLs alternativas ou customizadas.

2. **`sessionId` válido vindo do backend**
   - Teste o endpoint `/api/liveness/create-session` no Postman e veja se retorna um `sessionId` string.

3. **Permissões Rekognition na role do Cognito/Backend**
   - Deve ter `rekognition:StartFaceLivenessSession` e `rekognition:GetFaceLivenessSessionResults`.

4. **Widget realmente inicializado**
   - Verifique se `new FaceLiveness({ ... })` está sendo chamado **uma vez** com o `sessionId` correto.
   - O `render(container)` precisa ser executado sem erro.

5. **HTTPS**
   - O widget usa WebRTC; testes devem ser feitos em `https://` (ou `http://localhost` em desenvolvimento).

Se qualquer etapa falhar, o widget não inicia a sessão, a AWS nunca recebe frames 3D e o fallback local é acionado (sem antifraude real).

---

## 6. Checklist de Testes (para você ir ticando)

### Backend
- [ ] Endpoint `POST /api/liveness/create-session` retorna `200 OK` com `{ sessionId: "..." }`.
- [ ] Endpoint `GET /api/liveness/result/{sessionId}` retorna `200 OK` com `confidence` > 0 em sessões válidas.
- [ ] Logs mostram chamadas a `StartFaceLivenessSession` e `GetFaceLivenessSessionResults` sem erro.

### Frontend
- [ ] Modal customizado abre com overlay e container do widget visível.
- [ ] No DevTools → Network, ao iniciar a verificação, aparecem chamadas para Rekognition (AWS).
- [ ] Ao completar a prova de vida correta, `statusMessage` mostra confiança > 0.
- [ ] Ao simular um cenário ruim (foto de tela/celular), o score cai / sessão é rejeitada.

### AWS
- [ ] Role do Cognito/Backend tem as permissões Rekognition corretas.
- [ ] Região usada no backend (`DayFusion:LivenessRegion`) é a mesma configurada no widget (`region`).
- [ ] Testes feitos via HTTPS (ou localhost) para evitar bloqueios do navegador com câmera.

---

## 7. Observação Final – Uso com DayFusion

Para o projeto **DayFusion**, você pode:

- Usar este modal customizado como **componente plugável** (ex.: `<app-liveness-modal>`).
- Disparar o modal a partir do fluxo de login/autenticação.
- Armazenar o resultado no DynamoDB com os campos:
  - `SessionId`
  - `ConfidenceScore`
  - `Timestamp`
  - `DeviceInfo`
  - `UserId`
  - `FraudFlags` (se houver camada extra de IA).

Isso garante:

- Prova de vida 3D real da AWS
- UI 100% customizada
- Auditoria completa para banco/fintech
- Flexibilidade para evoluir o front sem quebrar a parte antifraude.

---

_Fim do guia._
