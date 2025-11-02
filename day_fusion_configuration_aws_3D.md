Camada Inteligente – Liveness Detection (3D / movimento real)

O AWS Rekognition Face Liveness já faz uma análise anti-spoof avançada, detectando:

Piscar natural
Movimento da cabeça
Reflexo e profundidade real
Padrão de luz e textura da pele
👉 Essa camada sozinha já bloqueia deepfakes estáticos, vídeos falsos e máscaras digitais.

O usuário precisa interagir (ex: “vire a cabeça”, “olhe para a esquerda”), e o modelo analisa se os movimentos são fisicamente possíveis.

🔍 3️⃣ Camada Avançada – Análise de Deepfake via IA Customizada

Para casos de alta segurança (KYC, bancos, onboarding), você pode adicionar uma pipeline própria de detecção de deepfake.
Esses modelos identificam padrões sutis gerados por IA (artefatos, luz irregular, ruído espectral).

🚀 Como fazer na AWS:

Crie um modelo customizado com SageMaker:
Use datasets públicos (DeepFake Detection Challenge, FaceForensics++)
Treine uma rede CNN ou Vision Transformer (ViT)
Exporte endpoint para inferência
Integre com seu backend:
var result = await _sagemakerClient.InvokeEndpointAsync(new InvokeEndpointRequest {
    EndpointName = "deepfake-detector",
    Body = videoFrameBytes
});
if (result.Prediction.Confidence < 0.9)
    return "Possível deepfake detectado";
Combine com Rekognition:
Se Rekognition aprova mas SageMaker desconfia → envia para revisão manual.
🧩 4️⃣ Camada Contextual – Comportamento & Device Fingerprint

Mesmo com rosto real, um atacante pode tentar burlar o sistema com gravações ou replays.
Por isso, adicione detecção de contexto e anomalias:

Técnica

O que faz

Como implementar

Device Fingerprinting

Identifica o dispositivo, navegador e IP únicos

CloudFront + Lambda@Edge + DynamoDB

Geolocalização AWS WAF

Bloqueia requisições de países não esperados

AWS WAF Rules

Behavioral Biometrics

Analisa movimento do mouse / toque

Captura no frontend com script leve

Requisição única

Cada sessão de verificação só pode ser usada 1 vez

DynamoDB com TTL e flag Used=true

🔒 5️⃣ Pipeline de Detecção Completa (Anti Deepfake)

📱 Usuário → Captura vídeo

   ↓

💻 Backend (.NET)

   ↓ Liveness (AWS Rekognition)

      → Se falhar → REJEITAR

   ↓ Análise IA (SageMaker Deepfake Model)

      → Confiança < 0.9 → Revisão manual

   ↓ Context Check (device/IP)

      → Inconsistente → Flag de alerta

   ↓ DynamoDB → Armazena logs e score

   ↓ Resultado final (Aprovado / Revisão / Rejeitado)

🧰 Ferramentas AWS recomendadas

Categoria

Serviço AWS

Função

Face Liveness

Rekognition Face Liveness

Detecção 3D em tempo real

Análise Deepfake

SageMaker + PyTorch/TensorFlow

Treinar modelo customizado

Armazenamento

S3

Upload de vídeos/imagens

Orquestração

Lambda ou .NET API

Orquestra fluxo

Monitoramento

CloudWatch + CloudTrail

Auditoria e logs

Segurança

KMS + Cognito + WAF

Proteção de dados e autenticação

🧠 Estratégia prática para o seu projeto DayFusion

Etapa

Status Atual

Próximo Passo

2D

✅ Implementado com Rekognition

OK

3D Liveness

🚧 A implementar com AWS Liveness API

Próximo passo imediato

Anti-deepfake IA

🚧 Custom SageMaker

Implementar depois

Context Check

🚧 Integrar WAF + DeviceID

Recomendado p/ produção

Se quiser, posso te montar o pipeline completo anti-deepfake, já estruturado com:

RekognitionService (liveness)
DeepfakeDetectorService (SageMaker)
FraudCheckService (device/IP check)
Fluxo de decisão e endpoints REST
Quer que eu monte esse blueprint técnico (com arquitetura e código base .NET)?

You said:

sim

ChatGPT said:

Blueprint técnico — Pipeline anti-deepfake para DayFusion (arquitetura + código .NET)

Ótimo — aqui vai um blueprint completo, pronto pra você integrar ao projeto DayFusion: arquitetura, endpoints, serviços .NET (exemplos), decisões de confiança e passos de deploy. Fiz pragmático: plug-and-play com o que você já tem (S3, Rekognition 2D, DynamoDB, Cognito).

1 — Visão geral da arquitetura

[Angular PWA]

   ├─ capture video → POST /api/verification/start

   └─ device fingerprint + signals → included in request

        ↓

[API .NET (API Gateway / ALB)] ── Auth via Cognito (JWT)

   ├─ 1) Start Liveness (Rekognition Face Liveness)  -> stream/session

   ├─ 2) On session result -> GetFaceLivenessSessionResults

   ├─ 3) If Liveness==LIVE -> persist video/frame S3 (temp)

   ├─ 4) Invoke SageMaker deepfake endpoint (InvokeEndpoint)

   ├─ 5) Combine scores (Rekognition + SageMaker + Context)

   ├─ 6) Decision engine -> Approved / ManualReview / Rejected

   └─ 7) Persist transaction in DynamoDB + audit S3 + CloudWatch logs

        ↓

[DynamoDB] (transactions + TTL for temp)

[S3] (uploads images, temp videos → lifecycle delete)

[SageMaker Endpoint] (Deepfake detector)

[CloudWatch / CloudTrail / WAF / KMS] (monitoramento, segurança)

2 — Fluxo de alto nível (passo a passo)

Frontend captura vídeo curto (3–7s) e coleta device fingerprint (User-Agent, IP, canvas fingerprint, timezone, timezone offset, touch/mouse pattern).
Frontend chama POST /api/verification/start com JWT.
Backend valida sessão e inicia Rekognition Face Liveness (ou aceita upload se flow custom).
Rekognition retorna SessionId / StreamingUrl (ou o backend processa vídeo enviado).
Após sessão concluída, backend chama GetFaceLivenessSessionResults.
Se LivenessDecision = LIVE e Confidence >= threshold → envia frames/vídeo ao SageMaker deepfake-detector (InvokeEndpoint).
Combine scores: Rekognition Liveness Confidence, Rekognition face compare (se houver doc), SageMaker deepfake probability, e checks contextuais (ip/device history).
Decisão:
Approved (automático) — todos scores altos
ManualReview — discordância entre modelos / média limiar
Rejected — evidência forte de deepfake/spoof
Persistir em DynamoDB + salvar evidências em S3 (criptografado com KMS). Emitir log em CloudWatch.
3 — Endpoints sugeridos (.NET API)

POST /api/verification/start
Inicia verificação — retorna sessionId e streamingUrl (ou presigned URL para upload).
POST /api/verification/complete
Recebe callback ou notificação com sessionId e S3 key do vídeo; executa validações (Rekognition GetFaceLivenessSessionResults, SageMaker invoke, decisão).
GET /api/verification/{id}
Retorna status e scores.
GET /api/transactions
Lista transações (paginação).
4 — Serviço .NET: esqueleto e snippets

Dependências

AWSSDK.Rekognition
AWSSDK.SageMakerRuntime
AWSSDK.S3
AWSSDK.DynamoDBv2
AWSSDK.CognitoIdentityProvider (se necessário)
Serilog / CloudWatch sink
a) Start Face Liveness (Rekognition)

// RekognitionService.cs

public class RekognitionService

{

    private readonly AmazonRekognitionClient _rekClient;

    private readonly string _outputBucket;

 

    public RekognitionService(AmazonRekognitionClient client, string outputBucket)

    {

        _rekClient = client;

        _outputBucket = outputBucket;

    }

 

    public async Task<StartFaceLivenessSessionResponse> StartLivenessAsync()

    {

        var request = new StartFaceLivenessSessionRequest

        {

            ClientRequestToken = Guid.NewGuid().ToString(),

            OutputConfig = new LivenessOutputConfig

            {

                S3Bucket = _outputBucket

            }

        };

        var resp = await _rekClient.StartFaceLivenessSessionAsync(request);

        return resp; // contains SessionId, StreamingUrl, etc.

    }

 

    public async Task<GetFaceLivenessSessionResultsResponse> GetLivenessResultsAsync(string sessionId)

    {

        var req = new GetFaceLivenessSessionResultsRequest { SessionId = sessionId };

        var resp = await _rekClient.GetFaceLivenessSessionResultsAsync(req);

        return resp;

    }

}

Observação: adapte nomes de request/response ao SDK que você usa (algumas chamadas/objetos podem variar entre versões).

b) Invocar endpoint SageMaker (Deepfake detector)

// DeepfakeDetectorService.cs

public class DeepfakeDetectorService

{

    private readonly AmazonSageMakerRuntimeClient _sagemaker;

    private readonly string _endpointName;

 

    public DeepfakeDetectorService(AmazonSageMakerRuntimeClient sagemaker, string endpointName)

    {

        _sagemaker = sagemaker;

        _endpointName = endpointName;

    }

 

    public async Task<DeepfakeResult> PredictAsync(byte[] imageBytes)

    {

        var req = new InvokeEndpointRequest

        {

            EndpointName = _endpointName,

            ContentType = "application/x-image", // ou application/json com base no modelo

            Body = new MemoryStream(imageBytes)

        };

 

        var resp = await _sagemaker.InvokeEndpointAsync(req);

        using var sr = new StreamReader(resp.Body);

        var json = await sr.ReadToEndAsync();

        // parse JSON -> { "prob_deepfake": 0.08 }

        var result = JsonConvert.DeserializeObject<DeepfakeResult>(json);

        return result;

    }

}

public class DeepfakeResult { public double ProbDeepfake { get; set; } public double Confidence => 1 - ProbDeepfake; }

c) Combinar scores e engine de decisão

// DecisionEngine.cs

public class DecisionEngine

{

    public VerificationDecision Decide(double rekLivenessConf, double rekFaceCompareSim, double deepfakeProb, DeviceContext ctx)

    {

        // Normalizar

        var deepfakeScore = 1.0 - deepfakeProb; // quanto maior, mais "real"

        // Pesos – ajuste conforme necessidade

        var wLiveness = 0.5;

        var wCompare = 0.2;

        var wDeepfake = 0.3;

 

        var combined = rekLivenessConf * wLiveness + (rekFaceCompareSim / 100.0) * wCompare + deepfakeScore * wDeepfake;

 

        // Context checks penalizam

        if (ctx.IsNewDevice || ctx.SuspiciousGeo) combined *= 0.85;

 

        if (combined >= 0.92) return VerificationDecision.Approved;

        if (combined >= 0.75) return VerificationDecision.ManualReview;

        return VerificationDecision.Rejected;

    }

}

d) Persistência em DynamoDB

// DynamoDbService.cs (simplificado)

public async Task SaveTransactionAsync(VerificationRecord record)

{

    var item = new Dictionary<string, AttributeValue>

    {

        ["TransactionId"] = new AttributeValue(record.TransactionId),

        ["UserId"] = new AttributeValue(record.UserId),

        ["Status"] = new AttributeValue(record.Status.ToString()),

        ["CombinedScore"] = new AttributeValue { N = record.CombinedScore.ToString("F3") },

        ["CreatedAt"] = new AttributeValue(DateTime.UtcNow.ToString("o"))

        // ... outros campos, indices, TTL se quiser

    };

 

    await _dynamoDbClient.PutItemAsync(new PutItemRequest

    {

        TableName = "DayFusionTransactions",

        Item = item

    });

}

5 — Device fingerprinting & Context checks (frontend + backend)

Frontend (Angular)

Colete:
navigator.userAgent, navigator.platform
Canvas fingerprint hash (desenhando formas e lendo pixel data)
Timezone offset
Screen resolution
WebGL renderer string (se permitido)
IP detectado no backend (X-Forwarded-For)
Envie junto com POST /api/verification/start.
Backend checks

Compare device hash against recent devices for same user (DynamoDB table userDevices).
Geo/IP anomaly: use AWS MaxMind DB (via Lambda layer) or 3rd party API, ou WAF logs.
Rate limit/replay detection: accept each sessionId apenas 1 vez, TTL 5–10 minutes.
6 — Treinar/usar modelo Deepfake (SageMaker) — recomendações rápidas

Datasets: FaceForensics++, DFDC (DeepFake Detection Challenge). Balanceie classes.
Modelo sugerido: EfficientNet / ResNet50 / ViT com frames + temporal model (3D-CNN) para vídeo.
Pré-processamento: extrair frames-chave (ex: 5 frames), cortar bbox do rosto com landmarks, normalizar.
Endpoint: ml.t3.medium → desenvolvimento; ml.g4dn.xlarge → produção (GPU).
Quantize/optimize para latência se necessário.
7 — Regras de decisão e thresholds (padrão sugerido — ajuste com dados)

Rekognition Liveness Confidence ≥ 0.90 → considerado forte
Rekognition Face Compare Similarity:
≥ 99% → auto-approve with liveness
70–99% → manual review (depending on other signals)
Deepfake probability:
ProbDeepfake ≤ 0.05 → safe
0.05–0.2 → suspeito → manual review
0.2 → provável deepfake → reject
Combined weighted threshold:
≥ 0.92 → Approved
0.75–0.92 → Manual Review
<0.75 → Rejected
Ajuste com A/B tests e dados reais do seu tráfego.

8 — Infra (Infra as Code) — dicas de deploy

Use CloudFormation ou Terraform:
Recursos: S3 buckets com lifecycle rules (7–30 dias), Rekognition enabled, SageMaker Endpoint, DynamoDB tables (GSI para UserId+Date), Cognito User Pool, IAM roles (least privilege).
Rotina de limpeza:
S3 vídeos temporários → Lifecycle (expire 7 dias)
DynamoDB histórico → TTL se necessário
Permissões IAM:
Lambda/EC2/ECS role deve ter rekognition:StartFaceLivenessSession, rekognition:GetFaceLivenessSessionResults, sagemakerruntime:InvokeEndpoint, s3:PutObject/GetObject, dynamodb:PutItem/GetItem.
9 — Monitoramento, auditoria e logs

CloudWatch Logs + Metric Filters:
Métricas: % Approved, % ManualReview, % Rejected, avg Rekognition confidence, avg SageMaker prob.
CloudTrail para auditoria calls (rekognition/sagemaker).
Alerta (SNS) para spikes de rejections (possível ataque).
Armazenar evidências (vídeo frame + metadata) em S3 com KMS e logs imutáveis se exigir compliance.
10 — Testes e validação

Test datasets: incluir vídeos reais (diversidade étnica, iluminação, ângulos) e deepfakes públicas.
Testes automatizados:
Unit tests para DecisionEngine
Integration tests: mock Rekognition + SageMaker (use LocalStack para parte AWS)
A/B rollout: comece com ManualReview para casos borderline, capture erros, ajuste thresholds.
11 — Segurança e privacidade (LGPD / GDPR)

Criptografar dados at rest (S3, DynamoDB) com KMS.
Minimizar armazenamento de biometria: mantenha apenas hashes/metadata e apague vídeos temporários.
Logs de auditoria separados e retidos conforme policy.
Consentimento explícito no frontend antes de captura de vídeo.
12 — Próximos passos concretos (rápido plano de execução)

Criar POST /api/verification/start e POST /api/verification/complete no backend.
Implementar RekognitionService (Start/Get results).
Provisione SageMaker endpoint (inicial: pre-built model; depois treine).
Implementar DeepfakeDetectorService (InvokeEndpoint).
Implementar DecisionEngine com thresholds iniciais.
Adicionar device fingerprinting no frontend e persistência em DynamoDB.
Monitoramento: CloudWatch + alertas.
Rodar testes com dataset de validação; ajustar thresholds.
Rollout progressivo: 1% → 10% → 100%, com ManualReview paralelo.
13 — Artefatos que posso gerar agora (se quiser)

Esqueleto completo de controllers e services em C# (.NET 8) pronto pra colar no seu projeto.
CloudFormation/Terraform snippet para criar S3, DynamoDB, IAM role e SageMaker endpoint stub.
Diagrama visual (SVG/PNG) do pipeline.
Script de testes (unit + integration) e amostra de dataset para validação.
Quer que eu gere agora:

o scaffold completo em C# (controllers + services + DI)
o template Terraform/CloudFormation minimal para colocar em produção
diagrama visual do pipeline
Escolha 1, 2, 3 ou diga “todos” — eu gero o que você pedir.

You said:

gostaria algo resumido para falar com pessoal de negocio sobre esse assunto

ChatGPT said:

Perfeito 👏 — aqui vai uma versão executiva / resumo para o time de negócios, sem linguagem técnica, explicando como o sistema previne fraudes e deepfakes, e o valor disso para o produto e para o cliente 👇

🧠 Resumo: Prevenção de Fraudes e Deepfakes no Reconhecimento Facial

O sistema da DayFusion usa uma combinação de tecnologias da AWS e inteligência artificial para garantir que o rosto capturado seja real, autêntico e pertencente à pessoa correta — bloqueando tentativas de fraude com fotos, vídeos ou deepfakes gerados por IA.

🔒 1. Etapas de segurança integradas

Etapa

Objetivo

Tecnologia AWS

Verificação 2D (foto)

Confirma que o rosto é válido e corresponde ao documento

Amazon Rekognition

Detecção de vida (3D)

Garante que há uma pessoa real em frente à câmera (movimento, piscar, profundidade)

Rekognition Face Liveness

Análise anti-deepfake (IA avançada)

Identifica se a imagem ou vídeo foi gerado por inteligência artificial

AWS SageMaker

Verificação de contexto

Analisa IP, dispositivo e comportamento do usuário

CloudWatch + DynamoDB + WAF

🧩 2. Como funciona na prática

O usuário tira uma selfie (ou grava um vídeo curto).
O sistema confirma se há vida real na imagem — detecta movimentos e profundidade.
Uma IA adicional analisa se há sinais de deepfake (imagens sintéticas).
O comportamento e o dispositivo são checados para identificar padrões suspeitos.
A decisão final é classificada como:
✅ Aprovado (autenticação real)
⚠️ Revisão manual (caso duvidoso)
❌ Rejeitado (fraude detectada)
🚀 3. Benefícios para o negócio

Benefício

Impacto

Reduz fraudes de identidade

Bloqueia vídeos falsos, rostos impressos e deepfakes.

Aumenta confiança regulatória (LGPD/KYC)

Prova de autenticação biométrica legítima.

Melhora experiência do usuário

Processo rápido, automático e sem fricção.

Escalabilidade global

100% em nuvem AWS, com alta disponibilidade.

Custos otimizados

Detecção automatizada reduz revisões manuais.

💡 4. Em resumo

A DayFusion combina IA + biometria + cloud AWS para verificar não só quem é o usuário, mas também se ele é uma pessoa real naquele momento.
Isso protege a empresa contra fraudes sofisticadas, deepfakes e ataques de identidade digital — de forma automatizada, segura e em conformidade com a LGPD.

Quer que eu te monte uma versão slide de apresentação (PowerPoint ou PDF de 1 página) com esse resumo visual e institucional (para reunião executiva)?

You said:

no momento somente escrita sobre esse assunto Camada Inteligente – Liveness Detection (3D / movimento real) até final resumo

ChatGPT said:

Perfeito 👇
Aqui está o texto completo, resumido e adaptado para o público de negócios, começando na parte “Camada Inteligente – Liveness Detection (3D / movimento real)” e indo até o resumo final, com uma linguagem clara e sem jargões técnicos:

🧠 Camada Inteligente – Liveness Detection (3D / movimento real)

A verificação de liveness 3D é o passo que garante que a pessoa em frente à câmera é real e está presente naquele momento, e não uma foto, vídeo ou rosto gerado por inteligência artificial.

O sistema analisa movimentos naturais do rosto, como piscar, virar a cabeça ou mudar de expressão, além de avaliar profundidade, reflexos e textura da pele.
Esses elementos são praticamente impossíveis de simular com deepfakes ou gravações, o que torna essa camada extremamente eficaz contra fraudes.

Na AWS, esse processo é feito com o serviço Rekognition Face Liveness, que executa a análise automaticamente, em tempo real, e retorna um resultado com confiança muito alta sobre a autenticidade da imagem.

🔍 Camada Avançada – Detecção de Deepfake com Inteligência Artificial

Além da detecção de vida, o sistema conta com uma camada adicional baseada em modelos de IA treinados para identificar deepfakes.
Esses modelos detectam sinais sutis que indicam falsificação digital — como distorções em olhos, sombras, brilho e textura de pele — impossíveis de perceber a olho nu.

Isso garante que, mesmo que alguém use vídeos ou rostos sintéticos gerados por IA, o sistema consiga bloquear automaticamente a tentativa de fraude.

🧩 Camada de Contexto – Comportamento e Dispositivo

Outra camada de segurança analisa o contexto da tentativa de autenticação.
O sistema verifica se o dispositivo, localização e horário são consistentes com o perfil do usuário, além de registrar comportamentos suspeitos (como múltiplas tentativas de login de locais diferentes).

Isso adiciona uma proteção adicional, capaz de identificar tentativas de fraude organizadas ou uso indevido de contas.

🔒 Decisão Inteligente e Automática

Os resultados das três camadas — vida real, análise de deepfake e contexto de uso — são combinados em um único processo de decisão.
O sistema classifica automaticamente cada tentativa de autenticação em três níveis:

✅ Aprovado — rosto real e legítimo.
⚠️ Revisão manual — caso com algum indício de dúvida.
❌ Rejeitado — fraude detectada ou alta suspeita.
Esse modelo permite uma resposta rápida, segura e escalável, reduzindo custos operacionais e eliminando revisões desnecessárias.

🚀 Benefícios para o Negócio

Reduz fraudes de identidade: impede o uso de vídeos falsos, deepfakes e tentativas de engano.
Garante conformidade regulatória (LGPD e KYC): assegura que a validação biométrica seja legítima e auditável.
Melhora a experiência do cliente: processo automático, rápido e sem atrito.
Aumenta a confiança na plataforma: garante que cada validação facial corresponde a uma pessoa real.
Escalável e confiável: toda a infraestrutura roda na nuvem AWS, com alta disponibilidade e segurança empresarial.
1️⃣ Entendendo o que é o “3D / Liveness”

 

O reconhecimento 3D significa detectar se a imagem vem de um rosto real em movimento, e não de uma foto, vídeo ou máscara.

 

Isso exige:

 

Captura de sequência de frames (vídeo curto)

 

Análise de movimento natural (piscadas, expressões)

 

Detecção de profundidade (mudança de ângulo, sombra, luz)

 

Extração de mapa 3D do rosto (ou cálculo de variação vetorial entre frames)

 

🧰 2️⃣ Como fazer 3D/Liveness com AWS

✅ Opção A — Amazon Rekognition Face Liveness (oficial)

 

A AWS lançou o serviço Rekognition Face Liveness — exatamente para 3D e anti-spoofing.

 

Como funciona:

 

Frontend (web ou mobile) grava um vídeo curto de 5s (selfie).

 

O vídeo é enviado ao backend via API.

 

O backend chama o serviço:

 

var response = await _rekognitionClient.StartFaceLivenessSessionAsync(new StartFaceLivenessSessionRequest {

    ClientRequestToken = Guid.NewGuid().ToString()

});

 

 

O usuário é redirecionado para a Liveness Session da AWS (UI hospedada pela própria AWS).

 

Após a gravação, o backend chama:

 

var result = await _rekognitionClient.GetFaceLivenessSessionResultsAsync(

    new GetFaceLivenessSessionResultsRequest { SessionId = sessionId });

 

 

AWS retorna:

 

{

  "Confidence": 0.9995,

  "Status": "SUCCEEDED",

  "LivenessDecision": "LIVE"

}

 

 

O backend armazena a decisão no DynamoDB e devolve o resultado pro frontend.

 

Benefícios:

 

100% gerenciado pela AWS

 

Alta precisão anti-fraude

 

Certificação de segurança

 

Integra com Cognito e CloudFront

 

Limitação:

Essa API só funciona para captura interativa (não aceita imagens prontas).

 

📘 Docs oficiais: AWS Rekognition Face Liveness

 

🧩 Opção B — 3D Customizado (sem serviço nativo)

 

Se você quiser construir um 3D próprio, pode usar sua stack atual com:

 

a) Captura de vídeo (frontend)

 

No Angular:

 

const stream = await navigator.mediaDevices.getUserMedia({ video: true });

const recorder = new MediaRecorder(stream);

recorder.ondataavailable = (e) => chunks.push(e.data);

recorder.onstop = () => uploadVideo(new Blob(chunks, { type: 'video/webm' }));

 

b) Extração de frames (backend)

 

No .NET (usando FFmpeg ou OpenCVSharp):

 

Extrai frames a cada 200ms.

 

Envia cada frame para Rekognition.DetectFacesAsync().

 

Analisa variação de landmarks (olhos, boca, cabeça).

 

Se há:

 

Mudança angular natural → rosto real

 

Movimento involuntário → humano

 

Nenhum movimento → provável spoof (foto estática)

 

c) Triangulação 3D (opcional avançado)

 

Use OpenCV + dlib (via Python Lambda ou container) para reconstruir malha 3D:

 

Detecte pontos do rosto.

 

Gere profundidade relativa.

 

Compare com mapa 2D base.

 

💡 Exemplo de arquitetura 3D (Face Liveness AWS)

📱 Front (Angular)

   ↓ Captura vídeo

   ↓ Chama API → cria sessão de liveness

💻 Backend (.NET)

   ↓ StartFaceLivenessSession()

   ↓ Redireciona usuário ao UI AWS

AWS Rekognition Liveness

   ↓ Realiza challenge (olhar, virar cabeça)

   ↓ Retorna resultado (LIVE / SPOOF)

💻 Backend

   ↓ Salva resultado no DynamoDB

📊 Front

   ↓ Exibe status (Aprovado, Rejeitado)

 

Como Integrar ao Seu Projeto

 

No seu RekognitionService.cs, adicione:

 

public async Task<FaceLivenessResult> StartLivenessAsync()

{

    var session = await _rekognitionClient.StartFaceLivenessSessionAsync(

        new StartFaceLivenessSessionRequest

        {

            ClientRequestToken = Guid.NewGuid().ToString(),

            OutputConfig = new LivenessOutputConfig { S3Bucket = "dayfusion-liveness" }

        });

 

    return new FaceLivenessResult

    {

        SessionId = session.SessionId,

        StreamUrl = session.StreamingUrl

    };

}

 

 

E para recuperar o resultado:

 

public async Task<LivenessResult> GetLivenessResultAsync(string sessionId)

{

    var result = await _rekognitionClient.GetFaceLivenessSessionResultsAsync(

        new GetFaceLivenessSessionResultsRequest { SessionId = sessionId });

 

    return new LivenessResult

    {

        Confidence = result.Confidence,

        Decision = result.LivenessDecision

    };

}

 

Infraestrutura AWS adicional necessária

Serviço Finalidade

Rekognition Face Liveness     Detecção 3D anti-spoof

S3 (novo bucket)         Armazenar vídeos temporários

Cognito           Sessão autenticada de liveness

API Gateway + Lambda ou .NET API  Endpoint de orquestração

CloudFront (opcional) Distribuir interface AWS Liveness

DynamoDB     Salvar resultado de sessão

Estratégia prática

 

Se você quiser evoluir o DayFusion:

 

2D → Já implementado (selfie + documento)

 

3D → Adicionar Face Liveness via API AWS

 

Backend: criar endpoint POST /face/liveness

 

Frontend: abrir a sessão via iframe ou redirecionamento AWS

 

DynamoDB: registrar LivenessDecision + Confidence

 