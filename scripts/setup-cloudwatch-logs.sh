#!/bin/bash

# Script para configurar CloudWatch Logs para Elastic Beanstalk

set -euo pipefail

AWS_PROFILE="${AWS_PROFILE:-default}"
REGION="${AWS_REGION:-us-east-1}"
EB_ENV_NAME="${EB_ENV_NAME:-dayfusion-api-env}"

export AWS_PROFILE
export AWS_DEFAULT_REGION="$REGION"

echo "🔧 Configurando CloudWatch Logs para Elastic Beanstalk..."
echo "   Ambiente: $EB_ENV_NAME"
echo "   Região: $REGION"
echo ""

# Log groups padrão do Elastic Beanstalk
LOG_GROUPS=(
    "/aws/elasticbeanstalk/$EB_ENV_NAME/var/log/eb-engine.log"
    "/aws/elasticbeanstalk/$EB_ENV_NAME/var/log/eb-hooks.log"
    "/aws/elasticbeanstalk/$EB_ENV_NAME/var/log/web.stdout.log"
    "/aws/elasticbeanstalk/$EB_ENV_NAME/var/log/web.stderr.log"
    "/aws/elasticbeanstalk/$EB_ENV_NAME/var/log/nginx/access.log"
    "/aws/elasticbeanstalk/$EB_ENV_NAME/var/log/nginx/error.log"
)

echo "📋 Criando log groups no CloudWatch..."

for log_group in "${LOG_GROUPS[@]}"; do
    echo "   Verificando: $log_group"
    
    if aws logs describe-log-groups --log-group-name-prefix "$log_group" --query "logGroups[?logGroupName=='$log_group'].logGroupName" --output text 2>/dev/null | grep -q "$log_group"; then
        echo "   ✅ Log group já existe: $log_group"
    else
        echo "   📦 Criando log group: $log_group"
        aws logs create-log-group \
            --log-group-name "$log_group" \
            --region "$REGION" 2>/dev/null || echo "   ⚠️  Erro ao criar (pode já existir ou sem permissão)"
    fi
done

echo ""
echo "🔧 Configurando Elastic Beanstalk para enviar logs ao CloudWatch..."

echo "📤 Aplicando configuração ao ambiente Elastic Beanstalk..."
aws elasticbeanstalk update-environment \
    --environment-name "$EB_ENV_NAME" \
    --option-settings \
        "Namespace=aws:elasticbeanstalk:cloudwatch:logs,OptionName=StreamLogs,Value=true" \
        "Namespace=aws:elasticbeanstalk:cloudwatch:logs,OptionName=DeleteOnTerminate,Value=false" \
        "Namespace=aws:elasticbeanstalk:cloudwatch:logs,OptionName=RetentionInDays,Value=7" \
    --region "$REGION" 2>&1 || {
    echo "⚠️  Não foi possível aplicar configuração automaticamente."
    echo "   Configure manualmente no console AWS:"
    echo "   1. Acesse Elastic Beanstalk → $EB_ENV_NAME → Configuration"
    echo "   2. Software → CloudWatch Logs"
    echo "   3. Habilite 'Stream logs to CloudWatch Logs'"
    echo "   4. Retention: 7 dias"
}

echo ""
echo "✅ Configuração concluída!"
echo ""
echo "📋 Log groups configurados:"
for log_group in "${LOG_GROUPS[@]}"; do
    echo "   - $log_group"
done
echo ""
echo "⚠️  Nota: Pode levar alguns minutos para os logs começarem a aparecer."
echo "   O Elastic Beanstalk precisa reiniciar para aplicar as configurações."

