#!/bin/bash
set -e

echo "🚀 Deploy Lambda Anti-Deepfake - DayFusion"
echo "=========================================="

# Configuração
REGION="${AWS_REGION:-us-east-1}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REPO="dayfusion-anti-deepfake"
LAMBDA_NAME="dayfusion-anti-deepfake"
IMAGE_TAG="latest"
S3_BUCKET="${S3_BUCKET:-dayfusion-bucket}"

echo "📋 Configuração:"
echo "  Region: $REGION"
echo "  Account ID: $ACCOUNT_ID"
echo "  ECR Repo: $ECR_REPO"
echo "  Lambda: $LAMBDA_NAME"
echo "  S3 Bucket: $S3_BUCKET"
echo ""

# Criar repositório ECR se não existir
echo "🔍 Verificando repositório ECR..."
if aws ecr describe-repositories --repository-names $ECR_REPO --region $REGION 2>/dev/null; then
  echo "✅ Repositório ECR já existe"
else
  echo "📦 Criando repositório ECR..."
  aws ecr create-repository --repository-name $ECR_REPO --region $REGION
  echo "✅ Repositório ECR criado"
fi

# Build da imagem Docker
echo ""
echo "🏗️  Building Lambda container..."
cd lambda-anti-deepfake

docker build -t $ECR_REPO:$IMAGE_TAG .
echo "✅ Imagem Docker construída"

# Login no ECR
echo ""
echo "🔐 Login no ECR..."
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com
echo "✅ Login bem-sucedido"

# Tag e push da imagem
echo ""
echo "📤 Push da imagem para ECR..."
docker tag $ECR_REPO:$IMAGE_TAG $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$ECR_REPO:$IMAGE_TAG
docker push $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$ECR_REPO:$IMAGE_TAG
echo "✅ Imagem enviada para ECR"

cd ..

# Verificar se Lambda já existe
echo ""
echo "🔍 Verificando se Lambda existe..."
if aws lambda get-function --function-name $LAMBDA_NAME --region $REGION 2>/dev/null; then
  echo "♻️  Atualizando função Lambda existente..."
  aws lambda update-function-code \
    --function-name $LAMBDA_NAME \
    --image-uri $ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$ECR_REPO:$IMAGE_TAG \
    --region $REGION
  
  # Atualizar configuração
  aws lambda update-function-configuration \
    --function-name $LAMBDA_NAME \
    --timeout 60 \
    --memory-size 1024 \
    --environment Variables="{S3_BUCKET=$S3_BUCKET,THRESHOLD_REVIEW=0.30,THRESHOLD_REJECT=0.60}" \
    --region $REGION
  
  echo "✅ Lambda atualizada"
else
  echo "❌ Lambda não existe. Por favor, crie-a manualmente ou com o script create-lambda-anti-deepfake.sh"
  echo ""
  echo "Comando sugerido:"
  echo "aws lambda create-function \\"
  echo "  --function-name $LAMBDA_NAME \\"
  echo "  --package-type Image \\"
  echo "  --code ImageUri=$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$ECR_REPO:$IMAGE_TAG \\"
  echo "  --role arn:aws:iam::$ACCOUNT_ID:role/lambda-anti-deepfake-role \\"
  echo "  --timeout 60 \\"
  echo "  --memory-size 1024 \\"
  echo "  --environment Variables=\"{S3_BUCKET=$S3_BUCKET,THRESHOLD_REVIEW=0.30,THRESHOLD_REJECT=0.60}\" \\"
  echo "  --region $REGION"
  exit 1
fi

echo ""
echo "✅ Deploy completo!"
echo "🎉 Lambda Anti-Deepfake está pronta para uso"
echo ""
echo "🧪 Para testar:"
echo "aws lambda invoke \\"
echo "  --function-name $LAMBDA_NAME \\"
echo "  --payload '{\"s3Key\":\"sessions/test-video.webm\"}' \\"
echo "  --region $REGION \\"
echo "  response.json"

