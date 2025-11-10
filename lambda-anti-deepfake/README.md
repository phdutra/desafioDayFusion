# Lambda Anti-Deepfake

Lambda function para análise de deepfake em vídeos capturados.

## Versão Atual: Stub 1.0.0

Esta é uma implementação **stub** inicial que retorna scores simulados para validação da arquitetura. A implementação do modelo real (TensorFlow/Hugging Face) será feita em fase futura.

## O que o Stub faz:

- ✅ Download de vídeo do S3
- ✅ Retorna scores simulados (80% natural, 15% suspeito, 5% deepfake)
- ✅ Simula análise de blink pattern, audio-sync e artifacts
- ✅ Logging estruturado para CloudWatch
- ✅ Tratamento de erros (retorna score neutro 0.5)

## Variáveis de Ambiente:

- `S3_BUCKET`: Bucket S3 com os vídeos (default: `dayfusion-bucket`)
- `THRESHOLD_REVIEW`: Threshold para revisão manual (default: `0.30`)
- `THRESHOLD_REJECT`: Threshold para rejeição (default: `0.60`)

## Deploy Manual (Pré-requisitos):

1. Criar repositório ECR:
```bash
aws ecr create-repository --repository-name dayfusion-anti-deepfake --region us-east-1
```

2. Build e push da imagem:
```bash
cd lambda-anti-deepfake
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com
docker build -t dayfusion-anti-deepfake:latest .
docker tag dayfusion-anti-deepfake:latest <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/dayfusion-anti-deepfake:latest
docker push <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/dayfusion-anti-deepfake:latest
```

3. Criar função Lambda via CLI:
```bash
aws lambda create-function \
  --function-name dayfusion-anti-deepfake \
  --package-type Image \
  --code ImageUri=<ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/dayfusion-anti-deepfake:latest \
  --role arn:aws:iam::<ACCOUNT_ID>:role/lambda-anti-deepfake-role \
  --timeout 60 \
  --memory-size 1024 \
  --environment Variables="{S3_BUCKET=dayfusion-bucket,THRESHOLD_REVIEW=0.30,THRESHOLD_REJECT=0.60}" \
  --region us-east-1
```

Ou use o script automatizado: `../scripts/deploy-lambda-anti-deepfake.sh`

## Teste Local:

```bash
python handler.py
```

## Implementação Futura (Modelo Real):

Para implementar o modelo real de detecção de deepfake:

1. **Blink Detection:**
   - MediaPipe Face Mesh ou dlib para detecção de landmarks
   - Análise de Eye Aspect Ratio (EAR) ao longo do tempo
   - Frequência e padrão de piscadas (15-25/min é normal)

2. **Lip-Sync Analysis:**
   - Wav2Lip ou SyncNet para análise de sincronismo
   - Comparar movimento labial com forma de onda do áudio
   - Detectar lags ou mismatches

3. **GAN/Diffusion Artifacts:**
   - CNNDetection ou similar para detectar artefatos generativos
   - Análise de consistência temporal entre frames
   - Detecção de warping e face blending

4. **Model Fusion:**
   - Combinar scores de todas as análises
   - Ensemble ou weighted average
   - Calibração com dados reais

## Recursos:

- [AWS Lambda Container](https://docs.aws.amazon.com/lambda/latest/dg/images-create.html)
- [MediaPipe](https://google.github.io/mediapipe/)
- [Wav2Lip](https://github.com/Rudrabha/Wav2Lip)
- [CNNDetection](https://github.com/peterwang512/CNNDetection)
- [Deepfake Detection Papers](https://paperswithcode.com/task/deepfake-detection)

## Segurança:

- Vídeos são temporários (lifecycle S3: 1h-24h)
- Lambda tem permissões mínimas (S3 read-only para bucket específico)
- Logs estruturados no CloudWatch (sem dados sensíveis)
- Score neutro (0.5) em caso de erro (não bloqueia transação)

