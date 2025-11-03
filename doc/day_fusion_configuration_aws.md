POC – DayFusion Face & Document Validation
🎯 Objetivo

Validar a eficiência do reconhecimento facial e documental (RG ou CNH) comparando:

A foto selfie do usuário com

A foto extraída do documento enviado

A POC deve exibir a similaridade e o resultado da validação (aprovado, revisão manual ou rejeitado).

🧩 Arquitetura Resumida
Frontend (Angular 19)
   |
   |-- Upload selfie e documento
   |-- Solicita presigned URL à API
   |-- Exibe progresso e resultado
   ↓
API (.NET 8)
   |-- Gera presigned URL (AWS S3)
   |-- Chama AWS Rekognition (DetectFaces / CompareFaces)
   |-- Calcula similaridade e status
   ↓
AWS
   |-- S3: Armazena imagens temporariamente
   |-- Rekognition: Realiza o match facial
   |-- DynamoDB: Guarda logs e resultados
   |-- Cognito: Autenticação (opcional)

💻 Interface do Usuário (UX/UI)
🔹 Tela 1 — Tela de Captura

Objetivo: Capturar selfie e documento.

Layout:

Cabeçalho: DayFusion - Validação Facial

Seções lado a lado (modo desktop) ou empilhadas (mobile):

📸 Selfie

Preview da câmera (usando getUserMedia)

Botão “Tirar Selfie”

🪪 Documento

Upload de imagem (frente do RG ou CNH)

Pré-visualização da imagem enviada

Rodapé com botão:

[ Validar Imagens ]


Tecnologias:

navigator.mediaDevices.getUserMedia({ video: true })

Angular Material + Glassmorphism (seguindo padrão visual do DayFusion)

Upload seguro via presigned URL (S3)

🔹 Tela 2 — Tela de Processamento

Objetivo: Exibir progresso da análise.

Layout:

Indicador animado (loading bar ou spinner)

Etapas:

🔄 Enviando arquivos para AWS...
🧠 Processando reconhecimento facial...
🧾 Comparando documento e selfie...


Feedback visual:

Barra de progresso

Mensagem de status em tempo real (usando WebSocket ou polling da API)

🔹 Tela 3 — Tela de Resultado

Objetivo: Mostrar o status e a similaridade.

Layout:

Imagens lado a lado:

Selfie capturada

Foto do documento

Resultado:

Similaridade: 98.7%
Status: ✅ Aprovado


Cores de feedback:

✅ Verde: Aprovado (>99%)

🟡 Amarelo: Revisão manual (70–99%)

❌ Vermelho: Rejeitado (<70%)

Botão: “Refazer Validação”

⚙️ Backend – Estrutura API (.NET 8)
Endpoints principais
POST /api/validation/presigned-url

Gera URLs temporárias para upload no S3.

[HttpPost("presigned-url")]
public IActionResult GetPresignedUrls([FromBody] PresignedRequest request)
{
    var selfieUrl = _awsService.GeneratePresignedUrl("selfies/");
    var docUrl = _awsService.GeneratePresignedUrl("documents/");
    return Ok(new { selfieUrl, docUrl });
}

POST /api/validation/compare

Recebe paths das imagens e chama o AWS Rekognition.

[HttpPost("compare")]
public async Task<IActionResult> CompareFaces([FromBody] CompareRequest model)
{
    var result = await _rekognitionService.CompareFacesAsync(model.Selfie, model.Document);
    return Ok(result);
}

GET /api/validation/result/{id}

Retorna status, similaridade e imagens.

🧮 Lógica de Classificação
Similaridade	Status	Ação
≥ 99%	✅ Approved	Automático
70–99%	🟡 Manual Review	Enfileirado p/ análise humana
< 70%	❌ Rejected	Automático
🧾 Casos de Teste
Caso	Selfie	Documento	Esperado
1	Mesmo rosto, boa luz	RG legível	✅ Approved
2	Rosto com óculos	RG claro	🟡 Manual Review
3	Documento desfocado	Selfie nítida	❌ Rejected
4	Selfie diferente	Documento válido	❌ Rejected
🧠 Tecnologias Front-end

Angular 19 + TypeScript

Angular Material (UI)

Glassmorphism / CSS Filters

getUserMedia API

Async/Await para fluxo assíncrono

S3 Upload via Presigned URL

Service Worker (PWA offline opcional)

🔧 Tecnologias Backend

.NET 8 Web API

AWS SDK for .NET

AWS Rekognition

AWS S3

DynamoDB

JWT Authentication

KMS Encryption

CloudWatch (monitoramento)

📋 Próximos Passos

Criar projeto Angular:

ng new dayfusion-poc --style=scss


Criar módulo face-validation

Implementar serviços:

upload.service.ts

rekognition.service.ts

Criar API .NET 8 com controllers ValidationController

Configurar AWS credentials no .env

Publicar API e Front-end no ambiente AWS (ou Render para testes)

Testar fluxo end-to-end com fotos reais

---

Especificação detalhada: Análise de Selfie e Documento

Objetivo: formalizar contratos, fluxos e limiares de decisão para evoluir de POC para MVP com resultado percentual e status claro.

Entidades principais

- Transação (`Transaction`): `Id`, `UserId`, `SelfieUrl` (S3 key), `DocumentUrl` (S3 key), `SimilarityScore` (0–100), `Status` (Pending, Processing, Approved, ManualReview, Rejected, Error), auditoria e revisão.
- Requisição de comparação (`FaceComparisonRequest`): `SelfieKey`, `DocumentKey`, `TransactionId?`.
- Resposta de comparação (`FaceComparisonResponse`): `SimilarityScore`, `Status`, `Message?`, `TransactionId`.

Rotas da API (atuais do backend)

- Upload/Presign S3
  - POST `api/Storage/presigned-url`
    - body: { "fileName": string, "contentType": "image/jpeg|image/png|image/webp", "transactionId?": string }
    - resp: { "url": string, "key": string, "expiresAt": ISO8601 }
  - POST `api/Storage/upload` (multipart) — alternativa direta se não usar presigned PUT

- Análise facial
  - POST `api/FaceRecognition/compare`
    - body: { "selfieKey": string, "documentKey": string, "transactionId?": string }
    - resp: { "similarityScore": number, "status": "Approved|ManualReview|Rejected|Error", "message?": string, "transactionId": string }
  - POST `api/FaceRecognition/similarity`
    - body: { "selfieKey": string, "documentKey": string }
    - resp: number (0–100)
  - POST `api/FaceRecognition/detect/{imageKey}` — valida se há rosto na imagem

- Transações
  - GET `api/Transactions` — lista do usuário
  - GET `api/Transactions/{transactionId}` — detalhe
  - GET `api/Transactions/review` — pendentes de revisão manual
  - PUT `api/Transactions/{transactionId}/review` — atualiza status/observações

Lógica de classificação (limiares)

- Similaridade ≥ 99.0 → Status: `Approved`
- 70.0 ≤ Similaridade < 99.0 → Status: `ManualReview`
- Similaridade < 70.0 → Status: `Rejected`

Observações

- Backend persiste resultado em DynamoDB e retorna `transactionId` na resposta de comparação.
- `SimilarityScore` é percentual (0–100). Arredondar a 1 casa no front para exibição.

Fluxo ponta a ponta (front)

1. Selfie: capturar via `getUserMedia` e gerar `Blob` (JPEG 90%).
2. Documento: upload da frente do RG/CNH (`jpeg/png/webp`).
3. Para cada arquivo:
   - Chamar `POST api/Storage/presigned-url` com `fileName` e `contentType`.
   - Fazer `PUT` para a URL retornada com o `Blob`.
   - Guardar `key` de cada arquivo (`selfieKey`, `documentKey`).
4. Chamar `POST api/FaceRecognition/compare` com as keys.
5. Exibir tela de processamento enquanto aguarda resposta.
6. Tela de Resultado: imagens lado a lado (usar `GET api/Storage/presigned-url/{key}` para leitura quando necessário), similaridade em %, badge de status.

Exemplos de payloads

Request — presign

```
POST api/Storage/presigned-url
{
  "fileName": "selfie.jpg",
  "contentType": "image/jpeg",
  "transactionId": "tx-123"
}
```

Response — presign

```
{
  "url": "https://s3.amazonaws.com/...",
  "key": "uploads/2025/10/tx-123/selfie.jpg",
  "expiresAt": "2025-10-30T15:00:00Z"
}
```

Request — comparação

```
POST api/FaceRecognition/compare
{
  "selfieKey": "uploads/2025/10/tx-123/selfie.jpg",
  "documentKey": "uploads/2025/10/tx-123/document.jpg",
  "transactionId": "tx-123"
}
```

Response — comparação

```
{
  "similarityScore": 98.7,
  "status": "Approved",
  "message": "Faces coincidem dentro do limiar de aprovação.",
  "transactionId": "tx-123"
}
```

Requisitos de UX (MVP)

- Mostrar etapas: 1 Selfie → 2 Documento → 3 Resultado.
- Botões: "Ativar Câmera", "Fazer Upload", "Validar Imagens", "Refazer".
- Cores: verde (Approved), amarelo (ManualReview), vermelho (Rejected).
- Acessibilidade: texto alternativo e foco visível.

Erros e validações

- Bloquear tipos inválidos (front e back).
- Exibir mensagem quando `detect` não encontrar rosto.
- Tratar timeout de presign/PUT (1 retry com backoff curto).

Métricas e auditoria

- Logar `transactionId`, `similarityScore`, `status`, `latência` total.
- Usar UTC em `ProcessedAt`.

Critérios de aceite

- Upload de selfie e documento com presign funcionando.
- Resultado exibe porcentagem e status conforme limiares.
- Transação gravada/atualizada no DynamoDB.
- Lista de transações do usuário visível na tela de histórico.