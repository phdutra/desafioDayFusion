#!/bin/bash
set -e

echo "⚙️  Atualizando appsettings.json com configuração anti-deepfake"
echo "==============================================================="

LAMBDA_NAME="${LAMBDA_NAME:-dayfusion-anti-deepfake}"
APPSETTINGS_FILE="backend/appsettings.json"

echo "📋 Configuração:"
echo "  Lambda Name: $LAMBDA_NAME"
echo "  Appsettings: $APPSETTINGS_FILE"
echo ""

# Verificar se arquivo existe
if [ ! -f "$APPSETTINGS_FILE" ]; then
  echo "❌ Arquivo não encontrado: $APPSETTINGS_FILE"
  exit 1
fi

# Backup
echo "💾 Criando backup..."
cp "$APPSETTINGS_FILE" "${APPSETTINGS_FILE}.backup"
echo "✅ Backup criado: ${APPSETTINGS_FILE}.backup"

# Adicionar configuração (usando jq se disponível, senão mostra instruções)
if command -v jq &> /dev/null; then
  echo ""
  echo "📝 Atualizando configuração com jq..."
  
  jq ".AWS.AntiDeepfakeLambda = \"$LAMBDA_NAME\"" "$APPSETTINGS_FILE" > /tmp/appsettings.tmp
  mv /tmp/appsettings.tmp "$APPSETTINGS_FILE"
  
  echo "✅ Configuração atualizada!"
  echo ""
  echo "🔍 Verificando:"
  jq '.AWS' "$APPSETTINGS_FILE"
else
  echo ""
  echo "⚠️  jq não encontrado. Por favor, adicione manualmente:"
  echo ""
  echo "Em backend/appsettings.json, na seção \"AWS\", adicione:"
  echo ""
  echo "  \"AntiDeepfakeLambda\": \"$LAMBDA_NAME\""
  echo ""
  echo "Exemplo:"
  echo "{"
  echo "  \"AWS\": {"
  echo "    \"Region\": \"us-east-1\","
  echo "    \"S3Bucket\": \"dayfusion-bucket\","
  echo "    \"AntiDeepfakeLambda\": \"$LAMBDA_NAME\""
  echo "  }"
  echo "}"
fi

echo ""
echo "✅ Concluído!"

