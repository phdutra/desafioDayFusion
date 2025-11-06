# 🧩 Diagnóstico Avançado — AWS Face Liveness no Angular

## 📋 Contexto
Durante a integração do **AWS Rekognition Face Liveness** com o projeto **DayFusion (Angular + .NET)**, foi identificado que o widget chega até a fase `"recording"`, mas nunca envia o vídeo para o backend, resultando em **score 0%** e status `"CREATED"`.

---

## 🧠 Diagnóstico Geral

### ✅ Funcionando corretamente
- Credenciais Cognito válidas (`hasAccessKey: true`, `hasSecretKey: true`)
- Sessão de Liveness criada com sucesso (`sessionId` válido)
- `FaceLivenessDetector` inicializado corretamente
- WebRTC inicializa (`currentPhase: "recording"`)
- Amplify configurado com `identityPoolId` e `region`

### ⚠️ Onde falha
Após iniciar a gravação, o vídeo **não é transmitido para a AWS Rekognition**.  
O log indica polling ativo, mas sem resposta final de sucesso.

Exemplo:
```
currentPhase: "recording"
sessionActive: true
isOpen: true
...
(não há logs de 'LivenessSucceeded' ou 'sessionCompleted')
```

---

## 🚨 Causa raiz provável
O problema ocorre porque o widget tenta enviar o vídeo para um endpoint local:
```
createSessionUrl: 'https://localhost:7197/api/Liveness/session'
resultsUrl: 'https://localhost:7197/api/Liveness/results'
```
Mas o **AWS FaceLivenessDetector requer endpoints da AWS**, não um proxy local.  
O proxy local (`localhost:7197`) não implementa o handshake WebRTC esperado.

---

## ✅ Soluções possíveis

### 🔹 Opção 1 — Usar endpoint real da AWS (recomendado)
No backend, crie a sessão diretamente com o **SDK AWS Rekognition**:

```csharp
var client = new AmazonRekognitionClient(RegionEndpoint.USEast1);
var response = await client.CreateFaceLivenessSessionAsync(new CreateFaceLivenessSessionRequest());
return Ok(response.SessionId);
```

No frontend Angular:

```typescript
const detector = new FaceLivenessDetector({
  sessionId: sessionIdFromBackend,
  region: 'us-east-1',
  credentials: AWS.config.credentials
});
```

Isso faz o vídeo ser enviado direto à AWS, sem proxy intermediário.

---

### 🔹 Opção 2 — Manter proxy local (com CORS)
Se quiser manter a API local (`https://localhost:7197`), é preciso liberar **CORS completo**.

#### Em `Program.cs`:
```csharp
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowLocalhost4200", policy =>
        policy.WithOrigins("https://localhost:4200")
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials());
});
app.UseCors("AllowLocalhost4200");
```

#### No controller:
```csharp
[EnableCors("AllowLocalhost4200")]
[HttpPost("Liveness/session")]
public async Task<IActionResult> CreateSession() { ... }
```

Sem isso, o browser bloqueia o handshake WebRTC e a sessão não envia vídeo.

---

## 🧩 Checklist Técnico Completo

| Item | Esperado | Situação atual |
|------|-----------|----------------|
| Cognito Identity Pool configurado | ✅ `us-east-1:xxxx-xxxx` | OK |
| Credenciais AWS carregadas antes do widget | ✅ | OK |
| HTTPS ativo | ✅ (`https://localhost:4200`) | OK |
| Endpoint correto (AWS Rekognition) | ✅ | ❌ usando localhost |
| Role IAM permite Rekognition + KinesisVideo | ✅ | Verificar |
| CORS liberado no backend | ✅ | ❌ se usando localhost |
| Permissão de câmera | ✅ | OK |

---

## 🔍 Passos de Teste

### 1️⃣ Teste WebRTC direto
No console:
```js
navigator.mediaDevices.getUserMedia({ video: true, audio: false })
```
Se falhar → problema de permissão no Chrome.

### 2️⃣ Verifique requests de rede
Aba **Network → filtro “Liveness”**:  
Procure requisição para `rekognition.amazonaws.com`.
Se não existir → vídeo não está sendo enviado.

### 3️⃣ Verifique ICE Connection
No console:
```
RTCPeerConnection.connectionState
```
Deve retornar `"connected"`. Se `"new"` ou `"failed"` → handshake falhou (CORS/proxy).

---

## 🧠 Resultado esperado (correto)
Após ajuste:
```
✅ Status: IN_PROGRESS
✅ Video streaming iniciado
✅ Status: SUCCEEDED
✅ Confidence: 0.98
✅ Decision: "LIVENESS_CONFIRMED"
```

---

## 🚀 Conclusão
- O fluxo Angular → AWS Cognito → Rekognition está correto.  
- O bloqueio estava na camada **proxy local (API)**.  
- ✅ **CORREÇÃO APLICADA**: Widget configurado para conexão direta AWS via WebRTC.

---

## ✅ Correções Implementadas

### 1. Frontend (`capture3d.component.ts`)
- ✅ Widget configurado para usar `sessionId` pré-criado no backend
- ✅ Streaming WebRTC direto para AWS Rekognition (não via proxy local)
- ✅ `create-session-url` e `results-url` usados apenas para criar/buscar sessão
- ✅ Credenciais Cognito configuradas globalmente para WebRTC

### 2. Backend (`Program.cs`)
- ✅ CORS melhorado com cache de preflight requests
- ✅ Headers expostos completos para suportar WebRTC

### 3. Fluxo Corrigido
```
1. Backend cria sessão na AWS Rekognition → retorna sessionId
2. Frontend recebe sessionId e configura credenciais Cognito
3. Widget usa sessionId + credenciais Cognito → conecta direto AWS via WebRTC
4. Vídeo vai direto para AWS Rekognition (sem passar por localhost:7197)
5. Backend busca resultados via GetFaceLivenessSessionResults
```

---

👨‍💻 **Autor:** Rapha Dutra  
📅 Atualizado: Novembro/2025  
🧠 Projeto: DayFusion – AWS Rekognition FaceID POC  
✅ **Status:** Correções aplicadas conforme diagnóstico
