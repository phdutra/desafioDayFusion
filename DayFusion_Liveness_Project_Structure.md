
# 🚀 DayFusion Liveness — Estrutura Técnica Final (Angular 19 + AWS + .NET 8)

## 🎯 Objetivo do Projeto
O **DayFusion Liveness** é uma solução completa para **validação facial com autenticação 3D e verificação de documento**.  
O sistema garante que o rosto pertence a uma pessoa real (vivacidade) e que coincide com a foto do documento (RG/CNH).  

A arquitetura utiliza **Angular 19** no front-end, **AWS Rekognition** para validação biométrica e um **back-end opcional .NET 8** para registro e auditoria.

---

## 🧱 Estrutura do Projeto

```
DayFusion/
├── frontend/          ← Angular 19 (principal camada AWS)
│   ├── src/app/
│   │   ├── core/
│   │   │   ├── aws/
│   │   │   ├── models/
│   │   │   └── utils/
│   │   ├── components/
│   │   │   ├── liveness-modal/
│   │   │   └── config-panel/
│   │   └── pages/
│   │       └── dashboard/
│   └── environments/
│       ├── environment.ts
│       └── environment.prod.ts
│
└── backend/           ← .NET 8 API (logs, histórico, auditoria)
    ├── Controllers/
    ├── Services/
    ├── Models/
    ├── appsettings.json
    └── Program.cs
```

---

## 🧩 1. FRONT-END (ANGULAR 19)

### 🔹 Responsabilidades
- Capturar vídeo e fotos automáticas (MediaRecorder / getUserMedia)
- Dar instruções por voz (SpeechSynthesis)
- Fazer upload direto pro S3 usando Cognito
- Rodar o **Rekognition Face Liveness** e **CompareFaces**
- Mostrar o resultado final (vivacidade + match do documento)

### 🔹 Bibliotecas AWS
```
npm install @aws-sdk/client-s3 @aws-sdk/client-rekognition @aws-sdk/client-cognito-identity @aws-sdk/credential-providers
```

### 🔹 Estrutura recomendada
```
src/app/core/aws/
 ├── s3.service.ts
 ├── rekognition.service.ts
 └── cognito.service.ts

src/app/core/utils/
 ├── media-recorder.util.ts
 ├── voice-sequence.util.ts
 └── photo-capture.util.ts
```

### 🔹 Exemplo: `rekognition.service.ts`
```typescript
import { RekognitionClient, CompareFacesCommand } from "@aws-sdk/client-rekognition";

@Injectable({ providedIn: 'root' })
export class RekognitionService {
  private client = new RekognitionClient({ region: 'us-east-1', credentials: this.credentials });

  async compareFaces(sourceBytes: Uint8Array, targetBytes: Uint8Array) {
    const command = new CompareFacesCommand({
      SourceImage: { Bytes: sourceBytes },
      TargetImage: { Bytes: targetBytes },
      SimilarityThreshold: 80
    });
    return await this.client.send(command);
  }
}
```

---

## 🎛️ 2. MÓDULO DE CONFIGURAÇÃO DE VOZ

### 🔹 Objetivo
Permitir que o usuário defina e **reordene instruções de voz** antes da verificação facial.

Exemplo de configuração salva:
```json
[
  { "texto": "Olhe para frente", "delay": 2000, "posicao": "frente" },
  { "texto": "Vire para esquerda", "delay": 2500, "posicao": "esquerda" },
  { "texto": "Vire para direita", "delay": 2500, "posicao": "direita" }
]
```

### 🔹 Exemplo de utilitário de voz
`voice-sequence.util.ts`
```typescript
export async function speakSequence(steps, capture) {
  for (const step of steps) {
    const utter = new SpeechSynthesisUtterance(step.texto);
    utter.lang = 'pt-BR';
    speechSynthesis.speak(utter);
    await new Promise(res => setTimeout(res, step.delay));
    capture(step.posicao);
  }
}
```

---

## 📸 3. CAPTURA FACIAL E DOCUMENTO

### 🔹 Liveness Modal
- Interface principal do processo
- Overlay circular central
- Instruções por voz (posição e direção)
- Captura automática de fotos + vídeo
- Upload final para S3
- Integração direta com **Rekognition**

### 🔹 Environment
`environment.ts`
```typescript
export const environment = {
  production: false,
  aws: {
    region: 'us-east-1',
    bucket: 'dayfusion-bucket',
    identityPoolId: 'us-east-1:xxxx-xxxx-xxxx-xxxx',
  }
};
```

---

## 🧠 4. BACK-END OPCIONAL (.NET 8)

### 🔹 Funções principais
- Gravar logs e resultados (`livenessScore`, `faceMatchScore`)
- Armazenar auditoria das sessões
- Disponibilizar relatórios históricos

### 🔹 Exemplo: `LivenessController.cs`
```csharp
[ApiController]
[Route("api/[controller]")]
public class LivenessController : ControllerBase
{
    private readonly LivenessService _service;
    public LivenessController(LivenessService service) => _service = service;

    [HttpPost("log")]
    public async Task<IActionResult> Log([FromBody] LivenessResult result)
    {
        await _service.SaveResultAsync(result);
        return Ok();
    }

    [HttpGet("history")]
    public async Task<IActionResult> GetHistory() =>
        Ok(await _service.GetAllAsync());
}
```

### 🔹 Modelo: `LivenessResult.cs`
```csharp
public class LivenessResult {
    public bool IsLive { get; set; }
    public double LivenessScore { get; set; }
    public double FaceMatchScore { get; set; }
    public string Status { get; set; }
    public string ReferenceImage { get; set; }
    public string DocumentImage { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
```

---

## ☁️ 5. CONFIGURAÇÃO AWS

### 🔹 Cognito Identity Pool
- Região: `us-east-1`
- Roles: `Auth` e `Unauth`
- Permissões:
  - `rekognition:CreateFaceLivenessSession`
  - `rekognition:GetFaceLivenessSessionResults`
  - `rekognition:CompareFaces`
  - `s3:PutObject` (prefixo `uploads/*`)

### 🔹 Bucket S3
- Nome: `dayfusion-bucket`
- CORS:
```json
[
  {
    "AllowedOrigins": ["http://localhost:4200", "https://localhost:4200"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["*"]
  }
]
```

---

## 🔄 6. FLUXO COMPLETO

1. Usuário abre o modal e segue instruções por voz.  
2. Fotos automáticas + vídeo são capturados localmente.  
3. Tudo é enviado pro **S3** (usando Cognito).  
4. O **Face Liveness** valida se é uma pessoa real.  
5. O usuário envia o documento (RG/CNH).  
6. O sistema executa **CompareFaces** (selfie × documento).  
7. Resultado consolidado com score final e status.  

Exemplo de resposta:
```json
{
  "isLive": true,
  "livenessScore": 98.7,
  "faceMatchScore": 95.2,
  "status": "Aprovado"
}
```

---

## ✅ 7. CONCLUSÃO

- **Front-end (Angular 19)** → captura, voz, upload, e integração direta com AWS.  
- **Back-end (.NET 8)** → registro e histórico.  
- **AWS (Rekognition, Cognito, S3, IAM)** → autenticação, armazenamento e validação biométrica.  

> O DayFusion Liveness é 100% escalável, sem necessidade de backend para autenticação,
> e com validação facial e documental totalmente automatizada via AWS.
