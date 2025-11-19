#!/usr/bin/env bash
set -euo pipefail

# Script de deploy completo para Frontend e Backend
# Frontend: Build Angular -> S3 -> CloudFront
# Backend: Publish .NET -> ZIP -> Elastic Beanstalk

AWS_PROFILE="${AWS_PROFILE:-default}"
REGION="${AWS_REGION:-us-east-1}"
FRONTEND_BUCKET="dayfusion-frontend"
CLOUDFRONT_DIST_ID="E3BF4NGDU3VKF5"
API_DOMAIN="dayfusion-api-env.eba-praptpxx.us-east-1.elasticbeanstalk.com"
EB_APP_NAME="${EB_APP_NAME:-dayfusion-api}"
EB_ENV_NAME="${EB_ENV_NAME:-dayfusion-api-env}"

export AWS_PROFILE
export AWS_DEFAULT_REGION="$REGION"

echo "🚀 Iniciando deploy completo do DayFusion..."
echo "📋 Configuração:"
echo "   - Profile: $AWS_PROFILE"
echo "   - Região: $REGION"
echo "   - Frontend Bucket: $FRONTEND_BUCKET"
echo "   - CloudFront: $CLOUDFRONT_DIST_ID"
echo "   - Backend EB: $EB_ENV_NAME"
echo ""

# Verificar dependências
if ! command -v jq >/dev/null 2>&1; then
  echo "❌ jq não encontrado. Instale antes de continuar (ex.: brew install jq)."
  exit 1
fi

if ! command -v dotnet >/dev/null 2>&1; then
  echo "❌ dotnet não encontrado. Instale o .NET SDK."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "❌ npm não encontrado. Instale o Node.js."
  exit 1
fi

# ============================================
# 1. BUILD DO FRONTEND
# ============================================
echo "📦 [1/4] Build do Frontend Angular..."
cd frontend

if [ ! -d "node_modules" ]; then
  echo "   📥 Instalando dependências do frontend..."
  npm install
fi

echo "   🏗️  Executando build de produção..."
npm run build -- --configuration production

if [ ! -d "dist/frontend/browser" ]; then
  echo "❌ Build do frontend falhou. Diretório dist/frontend/browser não encontrado."
  exit 1
fi

echo "✅ Build do frontend concluído!"
cd ..

# ============================================
# 2. PUBLISH DO BACKEND
# ============================================
echo ""
echo "📦 [2/4] Publish do Backend .NET..."
cd backend

echo "   🏗️  Executando dotnet publish..."
dotnet publish -c Release -o publish

if [ ! -d "publish" ] || [ ! -f "publish/DayFusion.API.dll" ]; then
  echo "❌ Publish do backend falhou."
  exit 1
fi

echo "   📦 Criando ZIP para deploy..."
cd publish
zip -r ../publish.zip . -q
cd ../..

echo "✅ Publish do backend concluído!"
echo "   📁 Arquivo: backend/publish.zip"

# ============================================
# 3. DEPLOY DO FRONTEND (S3 + CloudFront)
# ============================================
echo ""
echo "🌐 [3/4] Deploy do Frontend (S3 + CloudFront)..."

APP_DIST_DIR="frontend/dist/frontend/browser"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

if [ -d "$APP_DIST_DIR" ]; then
  echo "   📤 Sincronizando arquivos para S3..."
  aws s3 sync "$APP_DIST_DIR/" "s3://$FRONTEND_BUCKET/" --acl private --delete
  
  echo "   ✅ Arquivos sincronizados para S3"
else
  echo "   ⚠️  Diretório de build não encontrado, pulando sync S3..."
fi

# Configurar OAC (Origin Access Control)
OAC_NAME="oac-$FRONTEND_BUCKET"
OAC_ID=$(aws cloudfront list-origin-access-controls --query "OriginAccessControlList.Items[?Name && contains(Name, '$FRONTEND_BUCKET')].Id | [0]" --output text 2>/dev/null || echo "None")

if [ -z "$OAC_ID" ] || [ "$OAC_ID" == "None" ]; then
  echo "   🔐 Criando Origin Access Control..."
  CREATE_OAC_OUT=$(aws cloudfront create-origin-access-control --origin-access-control-config "Name=$OAC_NAME,Description=OAC for $FRONTEND_BUCKET,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3" --output json)
  OAC_ID=$(echo "$CREATE_OAC_OUT" | jq -r '.OriginAccessControl.Id')
  echo "   ✅ OAC criado: $OAC_ID"
else
  echo "   ✅ OAC existente: $OAC_ID"
fi

# Atualizar bucket policy
DIST_ARN="arn:aws:cloudfront::${ACCOUNT_ID}:distribution/${CLOUDFRONT_DIST_ID}"
read -r -d '' BUCKET_POLICY <<EOF || true
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontServicePrincipalReadOnly",
      "Effect": "Allow",
      "Principal": { "Service": "cloudfront.amazonaws.com" },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::${FRONTEND_BUCKET}/*",
      "Condition": { "StringEquals": { "AWS:SourceArn": "${DIST_ARN}" } }
    }
  ]
}
EOF

echo "$BUCKET_POLICY" > /tmp/${FRONTEND_BUCKET}_policy.json
aws s3api put-bucket-policy --bucket "$FRONTEND_BUCKET" --policy file:///tmp/${FRONTEND_BUCKET}_policy.json

# Atualizar CloudFront
echo "   🔄 Atualizando configuração do CloudFront..."
get_out=$(aws cloudfront get-distribution-config --id "$CLOUDFRONT_DIST_ID")
ETAG=$(echo "$get_out" | jq -r '.ETag')
echo "$get_out" | jq '.DistributionConfig' > /tmp/dist-config.orig.json

jq '. + { 
  "DefaultRootObject": "index.html",
  "CustomErrorResponses": {
    "Quantity": 2,
    "Items": [
      {
        "ErrorCode": 403,
        "ResponsePagePath": "/index.html",
        "ResponseCode": "200",
        "ErrorCachingMinTTL": 0
      },
      {
        "ErrorCode": 404,
        "ResponsePagePath": "/index.html",
        "ResponseCode": "200",
        "ErrorCachingMinTTL": 0
      }
    ]
  }
}' /tmp/dist-config.orig.json > /tmp/dist-config.step1.json

ORIGIN_INDEX=$(jq -r --arg domain "${FRONTEND_BUCKET}.s3.${REGION}.amazonaws.com" '[.Origins.Items | to_entries[] | select(.value.DomainName == $domain) | .key][0] // empty' /tmp/dist-config.step1.json)
if [ -z "$ORIGIN_INDEX" ]; then ORIGIN_INDEX=0; fi

jq --argjson idx "$ORIGIN_INDEX" --arg oac "$OAC_ID" '.Origins.Items[$idx] |= (. + { "OriginAccessControlId": $oac })' /tmp/dist-config.step1.json > /tmp/dist-config.step2.json

# Adicionar origem da API se não existir
python3 <<PY
import json

api_domain = "${API_DOMAIN}"
api_origin_id = "dayfusion-api-origin"
cache_policy_id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"

with open("/tmp/dist-config.step2.json") as f:
    config = json.load(f)

origins = config.setdefault("Origins", {"Quantity": 0, "Items": []})
items = origins.setdefault("Items", [])
if not any(item.get("DomainName") == api_domain for item in items):
    items.append({
        "Id": api_origin_id,
        "DomainName": api_domain,
        "OriginPath": "",
        "CustomHeaders": {"Quantity": 0},
        "ConnectionAttempts": 3,
        "ConnectionTimeout": 10,
        "OriginShield": {"Enabled": False},
        "CustomOriginConfig": {
            "HTTPPort": 80,
            "HTTPSPort": 443,
            "OriginProtocolPolicy": "http-only",
            "OriginSslProtocols": {"Quantity": 1, "Items": ["TLSv1.2"]},
            "OriginReadTimeout": 30,
            "OriginKeepaliveTimeout": 5
        }
    })
    origins["Quantity"] = len(items)

cache_behaviors = config.setdefault("CacheBehaviors", {"Quantity": 0, "Items": []})
cb_items = cache_behaviors.setdefault("Items", [])
if not any(item.get("PathPattern") == "/api/*" for item in cb_items):
    cb_items.append({
        "PathPattern": "/api/*",
        "TargetOriginId": api_origin_id,
        "ViewerProtocolPolicy": "https-only",
        "Compress": True,
        "SmoothStreaming": False,
        "AllowedMethods": {
            "Quantity": 7,
            "Items": ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"],
            "CachedMethods": {
                "Quantity": 2,
                "Items": ["GET", "HEAD"]
            }
        },
        "LambdaFunctionAssociations": {"Quantity": 0},
        "FunctionAssociations": {"Quantity": 0},
        "FieldLevelEncryptionId": "",
        "CachePolicyId": cache_policy_id,
        "OriginRequestPolicyId": origin_request_policy_id
    })
    cache_behaviors["Quantity"] = len(cb_items)

with open("/tmp/dist-config.final.json", "w") as f:
    json.dump(config, f)
PY

aws cloudfront update-distribution --id "$CLOUDFRONT_DIST_ID" --if-match "$ETAG" --distribution-config file:///tmp/dist-config.final.json

echo "   🔄 Criando invalidação do CloudFront..."
aws cloudfront create-invalidation --distribution-id "$CLOUDFRONT_DIST_ID" --paths "/*"

echo "✅ Deploy do frontend concluído!"
echo "   🌐 URL: https://${CLOUDFRONT_DIST_ID}.cloudfront.net"

# ============================================
# 4. DEPLOY DO BACKEND (Elastic Beanstalk)
# ============================================
echo ""
echo "🔧 [4/4] Deploy do Backend (Elastic Beanstalk)..."

if [ ! -f "backend/publish.zip" ]; then
  echo "❌ Arquivo backend/publish.zip não encontrado."
  exit 1
fi

echo "   📤 Fazendo upload para Elastic Beanstalk..."

# Verificar se EB CLI está disponível
if command -v eb >/dev/null 2>&1; then
  echo "   📦 Usando EB CLI para deploy..."
  cd backend
  eb deploy "$EB_ENV_NAME" --staged
  cd ..
else
  echo "   ⚠️  EB CLI não encontrado. Usando AWS CLI diretamente..."
  
  # Criar application version
  VERSION_LABEL="v$(date +%Y%m%d-%H%M%S)"
  echo "   📦 Criando versão: $VERSION_LABEL"
  
  # Upload para S3 (bucket temporário do EB)
  EB_S3_BUCKET=$(aws elasticbeanstalk describe-application-versions \
    --application-name "$EB_APP_NAME" \
    --max-items 1 \
    --query 'ApplicationVersions[0].SourceBundle.S3Bucket' \
    --output text 2>/dev/null || echo "")
  
  if [ -z "$EB_S3_BUCKET" ] || [ "$EB_S3_BUCKET" == "None" ]; then
    # Tentar obter bucket do ambiente
    EB_S3_BUCKET=$(aws elasticbeanstalk describe-environments \
      --environment-names "$EB_ENV_NAME" \
      --query 'Environments[0].ResourcesLoadBalancer.LoadBalancerName' \
      --output text 2>/dev/null | sed 's/.*-//' || echo "elasticbeanstalk-${REGION}-${ACCOUNT_ID}")
  fi
  
  S3_KEY="dayfusion-api/${VERSION_LABEL}.zip"
  
  echo "   📤 Upload para S3: s3://${EB_S3_BUCKET}/${S3_KEY}"
  aws s3 cp backend/publish.zip "s3://${EB_S3_BUCKET}/${S3_KEY}"
  
  # Criar application version
  echo "   📦 Criando application version..."
  aws elasticbeanstalk create-application-version \
    --application-name "$EB_APP_NAME" \
    --version-label "$VERSION_LABEL" \
    --source-bundle "S3Bucket=${EB_S3_BUCKET},S3Key=${S3_KEY}" \
    --description "Deploy automático $(date)"
  
  # Atualizar ambiente
  echo "   🚀 Atualizando ambiente..."
  aws elasticbeanstalk update-environment \
    --environment-name "$EB_ENV_NAME" \
    --version-label "$VERSION_LABEL"
  
  echo "   ✅ Deploy iniciado. Aguardando conclusão..."
  echo "   ⏳ Isso pode levar alguns minutos..."
  
  # Aguardar conclusão (opcional, pode ser removido se quiser fazer deploy assíncrono)
  echo "   📊 Status do deploy:"
  aws elasticbeanstalk describe-environments \
    --environment-names "$EB_ENV_NAME" \
    --query 'Environments[0].[Status,Health,VersionLabel]' \
    --output table
fi

echo ""
echo "✅ Deploy completo concluído!"
echo ""
echo "📋 Resumo:"
echo "   ✅ Frontend: https://${CLOUDFRONT_DIST_ID}.cloudfront.net"
echo "   ✅ Backend: https://${API_DOMAIN}"
echo ""
echo "🔍 Para verificar logs do backend:"
echo "   aws elasticbeanstalk describe-events --environment-name $EB_ENV_NAME --max-items 20"
echo ""

