
# 🔍 AWS Rekognition Face Liveness — Guia de Integração Angular + .NET

## 📘 Objetivo
Este documento orienta a implementação da **verificação de presença real (Liveness Detection)** utilizando o **Amazon Rekognition** em uma aplicação **Angular + .NET 8**.

O objetivo é permitir que a POC DayFusion realize captura 3D da face do usuário via Web, obtenha as imagens de auditoria (thumbnails) e retorne o score de confiança, conforme a API oficial da AWS.

---

## 🧩 Arquitetura Geral

```
[ Angular Frontend ]
     |
     |--> Captura via FaceLivenessDetector (WebRTC/Amplify)
     |--> Upload do Documento (RG/CNH)
     |--> Exibição dos Resultados
     |
[ .NET 8 API ]
     |
     |--> Rekognition (CreateFaceLivenessSession / GetFaceLivenessSessionResults)
     |--> Rekognition (CompareFaces)
     |--> DynamoDB + S3
```

---

## ⚙️ Etapas Técnicas

### 1️⃣ Backend (.NET 8)

#### Endpoint para iniciar sessão de Liveness
```csharp
[HttpPost("start-liveness")]
public async Task<IActionResult> StartLivenessSession()
{
    var request = new CreateFaceLivenessSessionRequest();
    var response = await _rekognition.CreateFaceLivenessSessionAsync(request);
    return Ok(new { SessionId = response.SessionId });
}
```

#### Endpoint para buscar resultados
```csharp
[HttpGet("liveness-result/{sessionId}")]
public async Task<IActionResult> GetLivenessResult(string sessionId)
{
    var result = await _rekognition.GetFaceLivenessSessionResultsAsync(new GetFaceLivenessSessionResultsRequest
    {
        SessionId = sessionId
    });

    return Ok(result);
}
```

**Observação:** bucket S3 e sessão devem estar na **mesma região**.

---

### 2️⃣ Frontend (Angular)

#### Instalação e configuração
```bash
npm install aws-amplify @aws-amplify/ui-angular
```

#### Importação no módulo
```typescript
import { LivenessDetector } from '@aws-amplify/ui-angular';
```

#### Componente
```html
<amplify-liveness-detector
  [sessionId]="sessionId"
  region="us-east-1"
  (onAnalysisComplete)="handleResult($event)">
</amplify-liveness-detector>
```

#### Tipos e lógica
```typescript
handleResult(event: any) {
  console.log('Resultado do Liveness:', event);
  this.apiService.saveLivenessResult(event).subscribe();
}
```

---

## 📡 Fluxo Completo

1. Usuário clica **“Iniciar Verificação”**
2. Angular chama backend `/start-liveness`
3. Backend → `CreateFaceLivenessSession` → retorna `SessionId`
4. Angular renderiza `<amplify-liveness-detector>` com o ID
5. Usuário realiza movimentos de face (instruções AWS)
6. AWS gera imagens de auditoria e score
7. Angular chama backend `/liveness-result/{sessionId}`
8. Backend obtém resultado via `GetFaceLivenessSessionResults`
9. Front exibe **thumbnails + score + status (SUCCEEDED/FAILED)**

---

## 📑 Requisitos do Browser (oficial AWS)
Fonte: [AWS Rekognition Face Liveness Requirements](https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness-requirements.html)

- Navegador: Chrome, Firefox, Safari, Edge (últimas versões)
- HTTPS obrigatório (WebRTC requer contexto seguro)
- Câmera frontal
- Resolução mínima: 480×640 pixels
- FPS mínimo: 15
- Iluminação homogênea
- Sessão expira em até **3 minutos**

---

## 📁 IAM Policy Recomendada

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "RekognitionAccess",
      "Effect": "Allow",
      "Action": [
        "rekognition:CreateFaceLivenessSession",
        "rekognition:GetFaceLivenessSessionResults",
        "rekognition:CompareFaces"
      ],
      "Resource": "*"
    },
    {
      "Sid": "S3Access",
      "Effect": "Allow",
      "Action": ["s3:PutObject","s3:GetObject","s3:DeleteObject"],
      "Resource": "arn:aws:s3:::dayfusion-bucket/*"
    },
    {
      "Sid": "DynamoAccess",
      "Effect": "Allow",
      "Action": [
        "dynamodb:DescribeTable",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:DeleteItem"
      ],
      "Resource": "arn:aws:dynamodb:us-east-1:405234571075:table/dayfusion_transactions"
    }
  ]
}
```

---

## 🔍 Diagnóstico de Problemas Comuns

| Problema | Causa | Solução |
|-----------|--------|----------|
| Sessão fica em CREATED | Vídeo não transmitido via WebRTC | Use `amplify-liveness-detector` oficial |
| Score 0% | Falha de captura de vídeo ou iluminação | Verifique câmera, HTTPS e iluminação |
| Thumbnails ausentes | Sessão não concluiu | Espere evento `onAnalysisComplete` |
| Erro `getUserMedia` | Navegador bloqueando câmera | Permitir acesso à câmera |
| Liveness expira | Tempo excedido | Recriar sessão se >3min |

---

## 📚 Referências Oficiais

- [AWS Rekognition Face Liveness API Docs](https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness.html)
- [Programming APIs](https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness-programming-api.html)
- [Requisitos do dispositivo](https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness-requirements.html)
- [Blog AWS Amplify + Liveness](https://aws.amazon.com/blogs/mobile/detect-real-users-with-aws-amplify-and-face-liveness/)
- [Exemplo oficial no GitHub (Angular)](https://github.com/aws-samples/aws-rekognition-liveness-detection)

---

## ✅ Próximos Passos

1. Implementar `<amplify-liveness-detector>` no Angular.  
2. Garantir HTTPS local com `ng serve --ssl true`.  
3. Testar transmissão e resultado em até 3 minutos.  
4. Capturar thumbnails e armazenar no S3.  
5. Comparar face com documento (FaceMatch).

---

**Autor:** Raphael Dutra  
**Projeto:** DayFusion – AWS Face Liveness + Document Match  
**Última atualização:** 02/11/2025
