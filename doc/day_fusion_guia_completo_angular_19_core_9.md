# DayFusion — Guia Completo (Conceito → Implementação)

**Versão do guia:** 1.0.0  
**Tecnologias:** Angular 19, .NET Core 9, AWS (S3, Rekognition, DynamoDB, Cognito, KMS, CloudWatch)  
**Data:** Outubro 2025

---

## 📚 Sumário

1. Introdução
2. Ementa & Objetivos
3. Arquitetura proposta (diagrama)
4. Pré-requisitos
5. Estrutura do repositório
6. Setup rápido (Quick Start)
7. Backend (.NET Core 9)
   - Estrutura e endpoints
   - Serviços AWS (S3, Rekognition, DynamoDB, Cognito)
   - Segurança e autenticação
   - Exemplos de código
8. Frontend (Angular 19)
   - Layout e páginas
   - Captura de câmera e upload seguro
   - PWA e otimizações
   - Exemplos de código
9. Fluxo de operação (end-to-end)
10. Deploy (Docker / AWS)
11. Observabilidade e métricas
12. Segurança e conformidade (LGPD)
13. KPIs e metas de desempenho
14. Próximos passos e roadmap
15. Anexos: scripts, env.template, mermaid diagram

---

## 1 — Introdução

Este documento consolida desde a ementa conceitual até a implementação prática do projeto **DayFusion** — uma solução de reconhecimento facial e revisão humana pensada para produção. A versão aqui descrita adota **Angular 19** no frontend e **.NET Core 9** (também chamado de .NET 9) no backend.

O objetivo: fornecer um guia que permita reproduzir rapidamente uma PoC funcional, com segurança, escalabilidade e conformidade à LGPD.

---

## 2 — Ementa & Objetivos

### Objetivos do projeto
- Construir uma PoC de reconhecimento facial com captura de selfie e documento.
- Automatizar processamento com AWS Rekognition e fluxo de revisão humana para scores intermediários.
- Garantir segurança (S3 presigned URLs, JWT, KMS) e conformidade (LGPD).

### Resultados esperados
- Frontend PWA moderno com captura de câmera e upload seguro.
- Backend em .NET 9 expondo APIs REST com autenticação (Cognito/JWT).
- Integração com S3, Rekognition, DynamoDB e observabilidade via CloudWatch.

---

## 3 — Arquitetura (Mermaid)

```mermaid
flowchart TD
  U[Usuário - PWA Angular 19] -->|Captura selfie & documento| AGW[API Gateway / Backend .NET 9]
  AGW -->|Pre-signed URL| U
  U -->|Upload direto| S3[S3 (SSE-KMS)]
  S3 -->|ObjectCreated| LambdaProc[AWS Lambda Processor (opcional)]
  LambdaProc -->|Chama| Rekognition[Amazon Rekognition]
  AGW -->|Chama Rekognition (sync) ou consulta DynamoDB| Rekognition
  Rekognition -->|Score| DB[(DynamoDB)]
  DB -->|Consulta| AGW
  AGW -->|Auth| Cognito
  AGW -->|Logs| CloudWatch

  subgraph Cloud
    S3
    LambdaProc
    Rekognition
    DB
    Cognito
    CloudWatch
  end
```

> Observação: você pode optar por executar o processamento de forma **sincrônica** (backend .NET chama Rekognition diretamente) ou **assíncrona** (S3 trigger → Lambda → Rekognition). Ambas as abordagens estão descritas abaixo.

---

## 4 — Pré-requisitos

- Conta AWS com permissões para S3, Rekognition, DynamoDB, Cognito, KMS, CloudWatch
- .NET SDK 9.x instalado
- Node.js 20+ e npm/pnpm
- Angular CLI compatível com Angular 19 (recomendado Angular CLI 19)
- Docker (opcional, para containerização)
- Git

---

## 5 — Estrutura do repositório

```
dayfusion/
├── backend/                       # .NET 9 API
│   ├── Controllers/
│   ├── Services/
│   ├── Models/
│   ├── Middleware/
│   ├── Program.cs
│   ├── appsettings.json
│   └── Dockerfile
├── frontend/                      # Angular 19 PWA
│   ├── src/
│   │   ├── app/
│   │   │   ├── pages/
│   │   │   ├── components/
│   │   │   └── services/
│   │   ├── assets/
│   │   └── manifest.webmanifest
│   ├── angular.json
│   └── Dockerfile
├── infra/                         # IaC (CloudFormation / Terraform / CDK)
├── docker-compose.yml
├── setup-aws.sh
├── env.template
└── README.md
```

---

## 6 — Quick Start (setup local + AWS minimal)

### 6.1 Variáveis de ambiente (copie `env.template` → `.env`)

```env
# AWS
AWS_REGION=us-east-1
AWS_S3_BUCKET=dayfusion-bucket
AWS_REKOGNITION_COLLECTION=dayfusion-collection
AWS_COGNITO_USERPOOL_ID=us-east-1_xxxxx
AWS_COGNITO_CLIENT_ID=xxxxxxxx
KMS_KEY_ID=alias/dayfusion-kms

# App
BACKEND_URL=http://localhost:5001
FRONTEND_URL=http://localhost:4200

# Other
JWT_ISSUER=https://cognito-idp.us-east-1.amazonaws.com/us-east-1_xxxxx
```

### 6.2 Backend (dev)

```bash
cd backend
dotnet restore
dotnet build
dotnet run --urls "http://localhost:5001"
```

### 6.3 Frontend (dev)

```bash
cd frontend
npm install
ng serve --host 0.0.0.0 --port 4200
# ou
pnpm start
```

---

## 7 — Backend (.NET Core 9)

### 7.1 Visão geral
API REST em .NET 9 organiza endpoints para:
- Autenticação (JWT via Cognito)
- Geração de presigned URLs S3
- Envio de imagens para Rekognition
- CRUD de transações em DynamoDB
- Endpoints de revisão manual

### 7.2 Principais controllers
- `AuthController` — integração com Cognito (token exchange, refresh)
- `StorageController` — presigned URLs, list/delete
- `FaceRecognitionController` — endpoints para comparar faces, iniciar processamento
- `TransactionsController` — histórico, filtros, export

### 7.3 Serviços (exemplos)
- `S3Service` — presigned URL (PUT/GET)
- `RekognitionService` — DetectFaces, CompareFaces, IndexFaces
- `DynamoDBService` — grava/consulta transações
- `CognitoService` — valida tokens, obtém claims
- `KmsService` — uso para criptografia de segredos

### 7.4 Exemplo: gerar presigned PUT URL (snippet C#)

```csharp
// S3Service.cs
using Amazon.S3;
using Amazon.S3.Model;
using Amazon.S3.Util;

public class S3Service
{
    private readonly IAmazonS3 _s3;
    private readonly string _bucket;

    public S3Service(IAmazonS3 s3, IConfiguration config)
    {
        _s3 = s3;
        _bucket = config["AWS_S3_BUCKET"];
    }

    public async Task<string> GeneratePreSignedPutUrlAsync(string key, TimeSpan expiry)
    {
        var request = new GetPreSignedUrlRequest
        {
            BucketName = _bucket,
            Key = key,
            Verb = HttpVerb.PUT,
            Expires = DateTime.UtcNow.Add(expiry)
        };
        return _s3.GetPreSignedURL(request);
    }
}
```

### 7.5 Exemplo: chamada ao Rekognition (CompareFaces)

```csharp
using Amazon.Rekognition;
using Amazon.Rekognition.Model;

public class RekognitionService
{
    private readonly IAmazonRekognition _rekog;

    public RekognitionService(IAmazonRekognition rekog)
    {
        _rekog = rekog;
    }

    public async Task<float> CompareFacesAsync(byte[] sourceImage, byte[] targetImage)
    {
        var request = new CompareFacesRequest
        {
            SourceImage = new Image { Bytes = new MemoryStream(sourceImage) },
            TargetImage = new Image { Bytes = new MemoryStream(targetImage) },
            SimilarityThreshold = 0F
        };

        var response = await _rekog.CompareFacesAsync(request);
        return response.FaceMatches.Any() ? response.FaceMatches.Max(m => m.Similarity) : 0f;
    }
}
```

### 7.6 Regras de decisão (exemplo)
- `>= 99%` → `APPROVED` (auto)
- `70% - 99%` → `MANUAL_REVIEW`
- `< 70%` → `REJECTED` (auto)

---

## 8 — Frontend (Angular 19)

### 8.1 Páginas principais
- `/home` — overview e CTA
- `/capture` — captura da selfie e upload de documento
- `/review` — painel de revisão humana (comparação lado a lado)
- `/transactions` — histórico e filtros

### 8.2 Captura de câmera (exemplo)

```ts
// camera.service.ts
export class CameraService {
  async getMediaStream(): Promise<MediaStream> {
    return await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
  }
}
```

### 8.3 Fluxo de upload seguro
1. Frontend solicita presigned PUT URL ao backend para `selfie.jpg` e `document.jpg`.
2. Frontend faz PUT direto para o S3 usando fetch/axios.
3. Ao completar upload, chama API para processar (opcional) ou o backend reagirá a eventos S3.

### 8.4 PWA e manifesto
- `manifest.webmanifest` configurado
- Service Worker com cache de shell

### 8.5 Boas práticas UI
- Use componentes standalone (Angular 19 suporta melhor arquitetura standalone)
- Acessibilidade (labels, ARIA)
- Feedback em tempo real ao usuário (spinner, progress)

---

## 9 — Fluxo de operação (end-to-end)

1. Usuário abre PWA → autentica via Cognito
2. Usuário captura selfie e documento
3. Front solicita presigned URLs → realiza uploads direto para S3
4. Backend processa: (a) Chamada direta ao Rekognition (sync) ou (b) S3 trigger → Lambda → Rekognition (async)
5. Resultado (score) salvo em DynamoDB
6. Resultado retornado ao frontend / caso `MANUAL_REVIEW` entra na fila do painel de revisão humana

---

## 10 — Deploy

### 10.1 Docker (local)

`backend/Dockerfile` e `frontend/Dockerfile` incluídos. Exemplo `docker-compose.yml` básico:

```yaml
version: '3.8'
services:
  backend:
    build: ./backend
    ports:
      - "5001:80"
    environment:
      - ASPNETCORE_ENVIRONMENT=Development
  frontend:
    build: ./frontend
    ports:
      - "4200:80"
```

### 10.2 AWS
- Recomendações: ECS/Fargate para containers .NET e Angular; ou Elastic Beanstalk para backend simples.
- Serverless: API Gateway + Lambda (.NET Lambda) para endpoints menores.
- Use CI/CD (GitHub Actions / CodePipeline) para build e deploy.

---

## 11 — Observabilidade e métricas

- CloudWatch: logs estruturados (Serilog para .NET)
- CloudTrail: auditoria de chamadas
- X-Ray (opcional): tracing distribuído
- Métricas sugeridas: tempo de upload, tempo de processamento Rekognition, taxa de aprovação, nº revisões manuais

---

## 12 — Segurança & Conformidade (LGPD)

- Consentimento explícito antes de captura/armazenamento
- Retenção mínima: política de retenção configurável no backend
- S3 com SSE-KMS (SSE-KMS)
- IAM: políticas de least-privilege para serviços
- Criptografia de segredos via AWS KMS
- Logs de acesso e auditoria via CloudTrail
- RLS/Masking quando retornar dados sensíveis ao frontend

---

## 13 — KPIs & SLAs

- Upload: < 2s (tamanho médio de imagem ≤ 200KB)
- Processamento: < 3s (sincrono) / < 10s (async end-to-end)
- Precisão esperada: > 99% em condições controladas (depende de imagem)
- Disponibilidade objetivo: 99.9%

---

## 14 — Próximos passos / Roadmap

- Implementar Liveness Detection (ML ou challenge-response)
- OCR de documentos e extração automática
- Dashboard Analytics com métricas por cliente
- Implementar ML customizado (SageMaker) para casos difíceis
- Multi-region deployment para redução de latência e resiliência

---

## 15 — Anexos

### env.template

```env
AWS_REGION=us-east-1
AWS_S3_BUCKET=
AWS_REKOGNITION_COLLECTION=
AWS_COGNITO_USERPOOL_ID=
AWS_COGNITO_CLIENT_ID=
KMS_KEY_ID=
BACKEND_URL=http://localhost:5001
FRONTEND_URL=http://localhost:4200
```

### setup-aws.sh (trecho)

```bash
#!/bin/bash
# cria bucket s3
aws s3api create-bucket --bucket $AWS_S3_BUCKET --region $AWS_REGION
# criar collection rekognition (se aplicável)
aws rekognition create-collection --collection-id $AWS_REKOGNITION_COLLECTION --region $AWS_REGION
```

---

## Contato e Suporte

- Time DayFusion
- Email: suporte@dayfusion.com

---

**Fim do documento**

