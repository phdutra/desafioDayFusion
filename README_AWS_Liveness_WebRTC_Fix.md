
# 🎥 AWS Rekognition Face Liveness — Diagnóstico e Correção WebRTC (Angular + .NET)

## 📘 Objetivo

Este documento detalha a correção e implementação do **WebRTC** no contexto da **Face Liveness Detection** da AWS Rekognition, conforme documentação oficial.  
Ele descreve as causas mais comuns de falha (“sessão permanece em CREATED”) e os ajustes necessários no Angular, servidor .NET e configurações AWS.

---

## 🧩 Contexto do Problema

**Sintoma:**  
- Sessão criada (`CreateFaceLivenessSession`) retorna OK.  
- Status permanece `CREATED` mesmo após tentativa de captura.  
- `Score = 0%`, `AuditImages = []`.

**Causa provável:**  
- O **WebRTC** não está enviando fluxo de vídeo da câmera para o serviço AWS.  
- O navegador não inicia a sessão segura de streaming (RTCPeerConnection).  
- O componente front-end não dispara `StartFaceLivenessSession`.

---

## 🧠 Como funciona o WebRTC na AWS Rekognition

De acordo com a documentação oficial:
> “The Face Liveness session uses WebRTC to securely stream video from the user’s browser or device to Amazon Rekognition. This stream is initiated and controlled via the FaceLivenessDetector client component.”  
> — [Fonte: AWS Rekognition Developer Guide](https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness.html)

### 📡 Fluxo Real do WebRTC (Browser ↔ Rekognition)
```
1. Backend cria sessão (CreateFaceLivenessSession)
2. Frontend inicia PeerConnection (WebRTC)
3. AWS retorna SDP Offer → Browser gera SDP Answer
4. Browser envia ICE Candidates → AWS confirma conexão
5. Stream de vídeo é enviado
6. AWS analisa vídeo e retorna resultados
```

Se **qualquer etapa entre 2 e 5 falhar**, a sessão nunca sai de “CREATED”.

---

## ⚙️ Passos Oficiais de Correção (Browser / Front-end Angular)

### 1️⃣ HTTPS é obrigatório
> WebRTC requer contexto seguro.  
> No Angular:
```bash
ng serve --ssl true --ssl-cert "cert.pem" --ssl-key "key.pem"
```
Se rodar em `http://localhost`, a câmera pode até abrir, mas o stream não será transmitido para AWS.

---

### 2️⃣ Permissões de câmera devem ser solicitadas explicitamente
```typescript
navigator.mediaDevices.getUserMedia({ video: true })
  .then(stream => console.log("Câmera OK"))
  .catch(err => console.error("Permissão negada:", err));
```

> **Importante:** A AWS cancela a sessão se o fluxo de vídeo não for iniciado em até 60 segundos após o `SessionId` ser criado.

---

### 3️⃣ Usar o componente oficial da AWS (quando disponível)
AWS fornece o **FaceLivenessDetector**, que já implementa toda a lógica WebRTC, SDP e ICE.

```html
<amplify-liveness-detector
  [sessionId]="sessionId"
  region="us-east-1"
  (onAnalysisComplete)="handleResult($event)">
</amplify-liveness-detector>
```

Esse componente cuida automaticamente de:
- Abrir câmera
- Criar `RTCPeerConnection`
- Negociar ICE
- Transmitir vídeo
- Receber callbacks com score e thumbnails

---

### 4️⃣ Evitar implementações WebRTC manuais em Angular
> A AWS **não expõe diretamente** endpoints SDP/ICE para uso manual.  
> Por isso, uma implementação customizada WebRTC (sem `FaceLivenessDetector`) não consegue estabelecer stream válido — apenas o SDK AWS gerencia o handshake correto com Rekognition.

**Alternativas seguras:**
- Usar o repositório oficial:  
  [aws-samples/aws-rekognition-liveness-detection](https://github.com/aws-samples/aws-rekognition-liveness-detection)
- Ou incorporar o componente React via Web Component no Angular:
  ```typescript
  import 'aws-amplify-ui-react';
  ```

---

### 5️⃣ Sessão expira em 3 minutos
> “Face Liveness sessions are valid for 3 minutes. After that, the session must be recreated.”  
> — AWS Docs

Portanto, se o usuário demorar para aceitar a câmera ou a aba for suspensa, recrie o `SessionId`.

---

## 🧰 Verificações de Diagnóstico

| Verificação | Resultado Esperado | Correção se falhar |
|--------------|-------------------|--------------------|
| HTTPS ativo | ✅ | Rode `ng serve --ssl true` |
| Permissão de câmera concedida | ✅ | Solicite com `getUserMedia()` |
| Sessão criada há < 3 min | ✅ | Recrie `SessionId` |
| ICE candidates enviados | ✅ | Verifique logs do navegador (RTC log) |
| AWS retorna SDP Answer | ✅ | Use componente AWS |
| Thumbnails gerados | ✅ | Sessão completada com sucesso |

---

## 🔐 Configurações AWS obrigatórias

### IAM Policy (mínima para Liveness)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "rekognition:CreateFaceLivenessSession",
        "rekognition:GetFaceLivenessSessionResults"
      ],
      "Resource": "*"
    }
  ]
}
```

### CORS do bucket S3
```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedOrigins": ["https://localhost:4200"],
    "ExposeHeaders": ["ETag"]
  }
]
```

---

## 📚 Fontes Oficiais AWS

- [Detecting face liveness](https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness.html)  
- [Programming API reference](https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness-programming-api.html)  
- [User requirements](https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness-requirements.html)  
- [Architecture and sequence diagrams](https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness-diagrams.html)  
- [Amplify + Face Liveness blog](https://aws.amazon.com/blogs/mobile/detect-real-users-with-aws-amplify-and-face-liveness/)  

---

## ✅ Resumo de Ações para o Projeto DayFusion

| Ação | Descrição | Status |
|------|------------|--------|
| Ativar HTTPS local | Obrigatório para WebRTC | 🔧 |
| Usar componente oficial | `amplify-liveness-detector` | 🔧 |
| Criar/atualizar SessionId a cada tentativa | Evita expiração | 🔧 |
| Testar em ambiente de boa luz e fps >15 | Recomendação AWS | 🔧 |
| Confirmar geração de thumbnails no S3 | Validação final | 🔧 |

---

**Autor:** Raphael Dutra  
**Projeto:** DayFusion — AWS Liveness + Document Match  
**Última atualização:** 02/11/2025  
**Fonte:** Documentação oficial AWS Rekognition Face Liveness
