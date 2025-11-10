# DayFusion — Camada Anti‑Deepfake (Complemento ao Face Liveness)

> **Resumo:** Este documento descreve a estratégia de **duas camadas** para autenticação facial **nível fintech** no DayFusion:  
> 1) **Face Liveness (AWS Rekognition)** — garante pessoa **real e presente**;  
> 2) **Anti‑Deepfake Layer (IA adicional)** — detecta **manipulações de vídeo/áudio** e **artefatos generativos** (deepfakes).  
> Inclui visão executiva, arquitetura, guia de implementação (Front/Back/AWS), políticas IAM, exemplos de payloads, auditoria (LGPD/ISO) e checklist.

---

## 📈 Parte 1 — Visão Executiva (para gestores)

**Problema:** fraudes com vídeos/fotos, replays e conteúdos sintéticos (deepfakes) evoluíram, exigindo proteção além do “liveness” tradicional.

**Solução em 2 camadas:**
1. **Liveness (AWS)**: valida **presença real** em 3D, movimentos naturais e evita **spoofing/replay/máscaras**.  
2. **Anti‑Deepfake (IA própria)**: analisa **padrões de piscar, microexpressões**, **sincronismo áudio‑vídeo** e **artefatos generativos** (GAN/diffusion), produzindo um **DeepfakeScore**.

**Benefícios para o negócio:**
- **Redução de fraude** e chargeback; conformidade **LGPD/ISO** via auditoria por sessão.  
- **Escalabilidade** (serverless), **custo sob demanda** e **tempo de resposta curto**.  
- **Diferencial competitivo**: “**Autenticação facial com proteção anti‑deepfake nativa — nível fintech**”.

**Métrica de decisão:**  
- Aprovar se: `LivenessDecision == REAL_PERSON` **e** `DeepfakeScore < 0.30`.  
- Revisão manual se: `0.30 ≤ DeepfakeScore < 0.60`.  
- Reprovar se: `DeepfakeScore ≥ 0.60` **ou** inconsistência forte de áudio‑vídeo.

---

## 🏗️ Parte 2 — Guia Técnico

### 2.1 Arquitetura (alto nível)

```
[Angular 19] --(captura vídeo+áudio)--> [API .NET / API Gateway]
         \                               | 
          \--(Face Liveness Widget)--> [Rekognition Liveness]
                                         |
[S3 c/ versionamento + lifecycle] <----- Lambda Anti-Deepfake (TF/HF)
                                         |
                           [DynamoDB - sessões + scores + device info]
                                         |
                                 [CloudWatch Logs + métricas]
```

**Serviços principais:**
- **Rekognition Face Liveness**: presença real (3D).
- **Lambda (container)** com **TensorFlow / Hugging Face**: anti‑deepfake.
- **S3** (vídeos temporários; lifecycle p/ expirar em ~1h a 24h).
- **DynamoDB**: rastreabilidade por sessão.
- **CloudWatch**: logs e métricas técnicas.
- **API .NET**: orquestra o fluxo e aplica política de decisão.

---

### 2.2 Fluxo de Autenticação (pipeline)

1) **Captura (Front)**: vídeo curto (3–5s) com áudio + chamada do **Face Liveness**.  
2) **Liveness**: obter `LivenessDecision` e `Confidence`.  
3) **Anti‑Deepfake** (backend):  
   - Subir mídia para S3 (URL assinada).  
   - **Lambda‑TF/HF** extrai features: blink rate, microexpressões, artefatos GAN/diffusion, **lip‑sync**.  
   - Retorno `DeepfakeScore` + indicadores (`blinkPattern`, `audioSync`).  
4) **Decisão**: aplicar thresholds e registrar no DynamoDB.  
5) **Auditoria**: salvar **SessionId, timestamps, device info**, versões de modelo, parâmetros e resultados.

---

### 2.3 Estrutura de Dados (DynamoDB)

**Tabela:** `DayFusionSessions` (PK: `SessionId`, SK opcional: `Timestamp`)

```json
{
  "SessionId": "uuid-123",
  "Timestamp": "2025-11-09T18:57:21Z",
  "UserId": "optional",
  "DeviceInfo": {
    "userAgent": "...",
    "ipHash": "sha256(...)" 
  },
  "Liveness": {
    "Decision": "REAL_PERSON|SPOOF|UNKNOWN",
    "Confidence": 0.98
  },
  "AntiDeepfake": {
    "DeepfakeScore": 0.12,
    "BlinkRate": 17.5,
    "BlinkPattern": "natural|anomalous",
    "AudioSync": "ok|lag|mismatch",
    "Artifacts": ["gan_edges", "warping", "temporal_inconsistency"]
  },
  "FraudScore": 0.15,
  "MatchScore": 0.93,
  "Status": "APPROVED|REVIEW|REJECTED",
  "ModelVersion": {
    "Liveness": "aws-<version>",
    "AntiDeepfake": "tf-1.3.0",
    "AudioSync": "hf-0.8.2"
  },
  "Retention": {
    "S3ObjectKey": "sessions/uuid-123/input.mp4",
    "ExpiresAt": "2025-11-09T20:00:00Z"
  }
}
```

---

### 2.4 API (sugestão de endpoints)

- `POST /api/liveness/session` → inicia sessão do **Face Liveness** (proxy/SDK).  
- `POST /api/anti-deepfake/analyze` → corpo: `{ "s3Url" | "base64" }` → retorna `DeepfakeScore`.  
- `POST /api/verify` → orquestra: chama liveness + anti‑deepfake e decide.  
- `GET  /api/sessions/{id}` → auditoria/consulta.

**Resposta consolidada (exemplo):**

```json
{
  "sessionId": "uuid-123",
  "liveness": { "decision": "REAL_PERSON", "confidence": 0.98 },
  "antiDeepfake": {
    "deepfakeScore": 0.12,
    "blinkPattern": "natural",
    "audioSync": "ok"
  },
  "matchScore": 0.93,
  "status": "APPROVED"
}
```

---

### 2.5 Back‑end (.NET 8 — esqueleto)

```csharp
// AntiDeepfakeController.cs
[ApiController]
[Route("api/anti-deepfake")]
public class AntiDeepfakeController : ControllerBase
{
    private readonly IStorageService _storage;
    private readonly IAntiDeepfakeService _ai;
    private readonly ISessionRepo _repo;

    [HttpPost("analyze")]
    public async Task<IActionResult> Analyze([FromBody] MediaInput input)
    {
        var s3Key = await _storage.PutAsync(input); // base64 -> S3 (URL assinada opc.)
        var result = await _ai.ScoreAsync(s3Key);   // chama Lambda/SageMaker
        await _repo.AppendAntiDeepfakeAsync(input.SessionId, result);
        return Ok(result);
    }
}
```

```csharp
// IAntiDeepfakeService.cs (contrato)
public interface IAntiDeepfakeService
{
    Task<AntiDeepfakeResult> ScoreAsync(string s3Key);
}
```

---

### 2.6 Lambda (TensorFlow/Hugging Face) — pseudo‑código

```python
# handler.py
def handler(event, context):
    s3_key = event["s3Key"]
    media = s3_download(s3_key)         # vídeo+áudio curto
    frames, audio = extract_av(media)   # amostragem fixa (ex.: 25 fps, 3s)

    # 1) Blink & microexpressions
    blink_rate = estimate_blink(frames)         # Hz/min
    microexpr = micro_expression_vector(frames) # PCA/embeddings

    # 2) Lip-sync (áudio-vídeo)
    sync = lipsync_confidence(frames, audio)    # 0..1

    # 3) Generative artifacts (GAN/diffusion)
    art_score = generative_artifacts(frames)    # 0..1

    deepfake_score = fuse(blink_rate, microexpr, sync, art_score)

    return {
        "DeepfakeScore": deepfake_score,
        "BlinkRate": blink_rate,
        "BlinkPattern": "natural" if is_natural(blink_rate) else "anomalous",
        "AudioSync": to_label(sync),
        "Artifacts": artifact_tags(art_score)
    }
```

**Observação:** empacotar como **Lambda container** (Docker) com dependências TF/HF e aceleração CPU/AVX; para GPU, considerar SageMaker endpoint.

---

### 2.7 IAM (exemplos mínimos)

**Roles do Identity Pool (Auth/Unauth) — Face Liveness + WebRTC:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "RekognitionLiveness",
      "Effect": "Allow",
      "Action": [
        "rekognition:CreateFaceLivenessSession",
        "rekognition:GetFaceLivenessSessionResults"
      ],
      "Resource": "*"
    },
    {
      "Sid": "KVSWebRTC",
      "Effect": "Allow",
      "Action": [
        "kinesisvideo:GetSignalingChannelEndpoint",
        "kinesisvideo:GetIceServerConfig",
        "kinesisvideo:ConnectAsMaster",
        "kinesisvideo:ConnectAsViewer"
      ],
      "Resource": "*"
    }
  ]
}
```

**Lambda Anti‑Deepfake:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["s3:GetObject"], "Resource": "arn:aws:s3:::<bucket>/*" },
    { "Effect": "Allow", "Action": ["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"], "Resource": "*" },
    { "Effect": "Allow", "Action": ["dynamodb:PutItem","dynamodb:UpdateItem"], "Resource": "arn:aws:dynamodb:*:*:table/DayFusionSessions" }
  ]
}
```

---

### 2.8 S3 (lifecycle + CORS)

**Lifecycle (expurgo curto para mídia sensível):**  
- Regra: prefixo `sessions/` → `Expiration: 1 day` (ou 1 hora, conforme risco/regulatório).

**CORS (exemplo local/HTTPS):**

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET","PUT"],
    "AllowedOrigins": ["https://localhost:4200","https://*.seu-dominio.com"],
    "ExposeHeaders": ["ETag"]
  }
]
```

---

### 2.9 Front‑end (Angular 19) — pontos práticos

- **Ordem correta:**  
  1) Verificar suporte **WebRTC** → 2) Obter credenciais **Cognito** → 3) **Renderizar** Liveness.  
- **Captura anti‑deepfake**: gravar 3–5s (MediaRecorder) com áudio; subir via URL assinada; mostrar status “Analisando autenticidade…”.  
- **UX de estados:** “Verificando…”, “Capturando rosto…”, “Autenticado ✅” / “Revisão 👀”.  
- **Acessibilidade:** feedback visual + textual; timeout e re‑tentativa.  
- **Privacidade:** gravar localmente, subir apenas o necessário; exibir aviso de consentimento.

---

### 2.10 Decisão & Thresholds

```text
If Liveness.Decision != REAL_PERSON => REJECT
Else if DeepfakeScore >= 0.60 => REJECT
Else if 0.30 <= DeepfakeScore < 0.60 => REVIEW (fila manual)
Else => APPROVE
```

**FraudScore** opcional: combinação de `DeepfakeScore`, `Device risk`, `IP reputation` e tentativas recentes.

---

### 2.11 Auditoria (LGPD/ISO)

Registrar por sessão:
- `SessionId`, `Timestamp`, `UserId` (ou pseudônimo), `DeviceInfo` (fingerprint não‑intrusivo, IP com **hash**).  
- `LivenessDecision`, `Confidence`, `DeepfakeScore`, `AudioSync`, `Artifacts`.  
- **Versões de modelo** (liveness e anti‑deepfake).  
- **Retention policy** (S3 + TTL lógico).  
- **Motivo da decisão** (`statusReason`) para explicabilidade.

**Boas práticas:**
- **Minimização de dados** + **criptografia em repouso** (S3/DDB) e em trânsito (TLS).  
- **Controles de acesso** (IAM) e **trilhas de auditoria** (CloudWatch).

---

## ✅ Checklist de Implementação

- [ ] Criar bucket S3 com **versionamento** e **lifecycle (≤24h)**.  
- [ ] Configurar **CORS** do S3 (localhost + domínios oficiais).  
- [ ] Garantir roles do **Identity Pool** com **Rekognition Liveness + KVS WebRTC**.  
- [ ] Criar **tabela DynamoDB** `DayFusionSessions`.  
- [ ] Empacotar **Lambda Anti‑Deepfake (TF/HF)** como **container**; variáveis: `S3_BUCKET`, `TABLE`, `THRESHOLD_REVIEW=0.30`, `THRESHOLD_REJECT=0.60`.  
- [ ] Implementar endpoints `.NET` (`/liveness/session`, `/anti-deepfake/analyze`, `/verify`, `/sessions/{id}`).  
- [ ] Angular: captura 3–5s com áudio, upload S3 (URL assinada), UI de estados.  
- [ ] Métricas/Logs no **CloudWatch**; alarmes para anomalias de score.  
- [ ] Documentar **política de decisão** e **retenção** (LGPD).

---

## ℹ️ Notas Importantes

- **Face Liveness** cobre **presença real**; **não** substitui análise de **deepfake**. A camada adicional é **complementar** e opcional por risco/segmento.  
- Ajuste os **limiares** com dados reais (calibração A/B).  
- Para volume alto/baixa latência, considerar **SageMaker endpoint** para o modelo anti‑deepfake.  
- Em ambientes móveis, assegurar **rede estável** e **câmera 30fps** para lip‑sync confiável.

---

**Contato/Ownership interno:** DayFusion Core Team — Segurança & Biometria.
