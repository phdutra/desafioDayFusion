#!/bin/bash
set -e

echo "🗑️  Configurando S3 Lifecycle para vídeos temporários"
echo "====================================================="

REGION="${AWS_REGION:-us-east-1}"
S3_BUCKET="${S3_BUCKET:-dayfusion-bucket}"
EXPIRATION_DAYS="${EXPIRATION_DAYS:-1}"

echo "📋 Configuração:"
echo "  Region: $REGION"
echo "  S3 Bucket: $S3_BUCKET"
echo "  Expiration: $EXPIRATION_DAYS dia(s)"
echo ""

# Criar arquivo de configuração de lifecycle
LIFECYCLE_CONFIG=$(cat <<EOF
{
  "Rules": [
    {
      "Id": "ExpireVideos",
      "Status": "Enabled",
      "Filter": {
        "Prefix": "sessions/"
      },
      "Expiration": {
        "Days": $EXPIRATION_DAYS
      },
      "NoncurrentVersionExpiration": {
        "NoncurrentDays": $EXPIRATION_DAYS
      }
    }
  ]
}
EOF
)

echo "🔍 Verificando se bucket existe..."
if aws s3api head-bucket --bucket $S3_BUCKET --region $REGION 2>/dev/null; then
  echo "✅ Bucket encontrado"
else
  echo "❌ Bucket não encontrado: $S3_BUCKET"
  exit 1
fi

# Aplicar lifecycle policy
echo ""
echo "📝 Aplicando lifecycle policy..."
echo "$LIFECYCLE_CONFIG" > /tmp/lifecycle-config.json

aws s3api put-bucket-lifecycle-configuration \
  --bucket $S3_BUCKET \
  --lifecycle-configuration file:///tmp/lifecycle-config.json \
  --region $REGION

rm /tmp/lifecycle-config.json

echo "✅ Lifecycle policy aplicada com sucesso!"
echo ""
echo "📊 Detalhes da política:"
echo "  • Vídeos em sessions/ expiram em $EXPIRATION_DAYS dia(s)"
echo "  • Versões antigas também são removidas"
echo ""
echo "🔍 Para verificar:"
echo "aws s3api get-bucket-lifecycle-configuration --bucket $S3_BUCKET --region $REGION"

