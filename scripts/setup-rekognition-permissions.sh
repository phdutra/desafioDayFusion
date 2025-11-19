#!/bin/bash

# Script para configurar permissões IAM do AWS Rekognition para Elastic Beanstalk

set -euo pipefail

AWS_PROFILE="${AWS_PROFILE:-default}"
REGION="${AWS_REGION:-us-east-1}"
EB_ENV_NAME="${EB_ENV_NAME:-dayfusion-api-env}"

export AWS_PROFILE
export AWS_DEFAULT_REGION="$REGION"

echo "🔐 Configurando permissões IAM para AWS Rekognition..."
echo "   Ambiente: $EB_ENV_NAME"
echo "   Região: $REGION"
echo ""

# Obter IAM Role do Elastic Beanstalk
echo "📋 Obtendo IAM Role do Elastic Beanstalk..."

# Tentar obter da configuração do ambiente primeiro
IAM_ROLE=$(aws elasticbeanstalk describe-environment-resources \
    --environment-name "$EB_ENV_NAME" \
    --query 'EnvironmentResources.IamRole' \
    --output text \
    --region "$REGION" 2>/dev/null || echo "")

# Se não encontrou, tentar obter da instância EC2
if [ -z "$IAM_ROLE" ] || [ "$IAM_ROLE" == "None" ]; then
    echo "   🔍 Tentando obter IAM Role da instância EC2..."
    INSTANCE_ID=$(aws elasticbeanstalk describe-environment-resources \
        --environment-name "$EB_ENV_NAME" \
        --query 'EnvironmentResources.Instances[0].Id' \
        --output text \
        --region "$REGION" 2>/dev/null || echo "")
    
    if [ -n "$INSTANCE_ID" ] && [ "$INSTANCE_ID" != "None" ]; then
        IAM_PROFILE_ARN=$(aws ec2 describe-instances \
            --instance-ids "$INSTANCE_ID" \
            --query 'Reservations[0].Instances[0].IamInstanceProfile.Arn' \
            --output text \
            --region "$REGION" 2>/dev/null || echo "")
        
        if [ -n "$IAM_PROFILE_ARN" ] && [ "$IAM_PROFILE_ARN" != "None" ]; then
            # Extrair nome da role do ARN (formato: arn:aws:iam::ACCOUNT:instance-profile/PROFILE-NAME)
            IAM_PROFILE_NAME=$(echo "$IAM_PROFILE_ARN" | sed 's/.*instance-profile\///')
            # Obter a role associada ao instance profile
            IAM_ROLE=$(aws iam get-instance-profile \
                --instance-profile-name "$IAM_PROFILE_NAME" \
                --query 'InstanceProfile.Roles[0].RoleName' \
                --output text \
                --region "$REGION" 2>/dev/null || echo "")
        fi
    fi
fi

if [ -z "$IAM_ROLE" ] || [ "$IAM_ROLE" == "None" ]; then
    echo "❌ Não foi possível obter a IAM Role automaticamente."
    echo ""
    echo "   Por favor, forneça o nome da IAM Role manualmente:"
    echo "   Exemplo: aws-elasticbeanstalk-ec2-role"
    read -p "   IAM Role name: " IAM_ROLE
    
    if [ -z "$IAM_ROLE" ]; then
        echo "❌ IAM Role não fornecida. Abortando."
        exit 1
    fi
fi

echo "✅ IAM Role encontrada: $IAM_ROLE"
echo ""

# Criar política para Rekognition
POLICY_NAME="DayFusionRekognitionPolicy"
POLICY_DOCUMENT=$(cat <<EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "RekognitionDetectText",
            "Effect": "Allow",
            "Action": [
                "rekognition:DetectText"
            ],
            "Resource": "*"
        },
        {
            "Sid": "RekognitionDetectFaces",
            "Effect": "Allow",
            "Action": [
                "rekognition:DetectFaces"
            ],
            "Resource": "*"
        },
        {
            "Sid": "RekognitionCompareFaces",
            "Effect": "Allow",
            "Action": [
                "rekognition:CompareFaces"
            ],
            "Resource": "*"
        },
        {
            "Sid": "RekognitionCollectionOperations",
            "Effect": "Allow",
            "Action": [
                "rekognition:IndexFaces",
                "rekognition:SearchFacesByImage",
                "rekognition:CreateCollection",
                "rekognition:DescribeCollection",
                "rekognition:ListCollections",
                "rekognition:ListFaces"
            ],
            "Resource": "*"
        },
        {
            "Sid": "S3ReadAccessForRekognition",
            "Effect": "Allow",
            "Action": [
                "s3:GetObject"
            ],
            "Resource": "arn:aws:s3:::dayfusion-bucket/*"
        }
    ]
}
EOF
)

echo "📝 Criando política IAM: $POLICY_NAME"
echo "$POLICY_DOCUMENT" > /tmp/rekognition-policy.json

# Verificar se a política já existe
EXISTING_POLICY=$(aws iam list-policies \
    --scope Local \
    --query "Policies[?PolicyName=='$POLICY_NAME'].Arn" \
    --output text 2>/dev/null || echo "")

if [ -n "$EXISTING_POLICY" ] && [ "$EXISTING_POLICY" != "None" ]; then
    echo "   ✅ Política já existe: $EXISTING_POLICY"
    POLICY_ARN="$EXISTING_POLICY"
else
    echo "   📦 Criando nova política..."
    CREATE_RESULT=$(aws iam create-policy \
        --policy-name "$POLICY_NAME" \
        --policy-document file:///tmp/rekognition-policy.json \
        --description "Permissões para AWS Rekognition no DayFusion" \
        --output json 2>&1)
    
    if echo "$CREATE_RESULT" | grep -q "EntityAlreadyExists"; then
        echo "   ⚠️  Política já existe com outro nome, buscando..."
        POLICY_ARN=$(aws iam list-policies \
            --scope Local \
            --query "Policies[?PolicyName=='$POLICY_NAME'].Arn" \
            --output text)
    else
        POLICY_ARN=$(echo "$CREATE_RESULT" | grep -oP '"Arn":\s*"\K[^"]+' || echo "")
    fi
    
    if [ -z "$POLICY_ARN" ]; then
        echo "   ❌ Erro ao criar política. Verifique as permissões."
        exit 1
    fi
    
    echo "   ✅ Política criada: $POLICY_ARN"
fi

echo ""
echo "🔗 Anexando política à IAM Role: $IAM_ROLE"

# Verificar se a política já está anexada
ATTACHED_POLICIES=$(aws iam list-attached-role-policies \
    --role-name "$IAM_ROLE" \
    --query "AttachedPolicies[?PolicyArn=='$POLICY_ARN'].PolicyArn" \
    --output text 2>/dev/null || echo "")

if [ -n "$ATTACHED_POLICIES" ] && [ "$ATTACHED_POLICIES" == "$POLICY_ARN" ]; then
    echo "   ✅ Política já está anexada à role."
else
    echo "   📎 Anexando política..."
    aws iam attach-role-policy \
        --role-name "$IAM_ROLE" \
        --policy-arn "$POLICY_ARN" \
        --region "$REGION" 2>&1 || {
        echo "   ⚠️  Erro ao anexar política. Verifique as permissões."
        echo "   Você pode anexar manualmente no console AWS:"
        echo "   1. IAM → Roles → $IAM_ROLE"
        echo "   2. Add permissions → Attach policies"
        echo "   3. Buscar: $POLICY_NAME"
        exit 1
    }
    echo "   ✅ Política anexada com sucesso!"
fi

echo ""
echo "✅ Configuração concluída!"
echo ""
echo "📋 Resumo:"
echo "   - IAM Role: $IAM_ROLE"
echo "   - Política: $POLICY_NAME ($POLICY_ARN)"
echo ""
echo "⚠️  Nota: As permissões podem levar alguns segundos para propagar."
echo "   Se o erro persistir, aguarde 1-2 minutos e tente novamente."
echo ""
echo "🔍 Permissões configuradas:"
echo "   ✅ rekognition:DetectText"
echo "   ✅ rekognition:DetectFaces"
echo "   ✅ rekognition:CompareFaces"
echo "   ✅ rekognition:IndexFaces"
echo "   ✅ rekognition:SearchFacesByImage"
echo "   ✅ rekognition:CreateCollection"
echo "   ✅ rekognition:DescribeCollection"
echo "   ✅ s3:GetObject (dayfusion-bucket)"

