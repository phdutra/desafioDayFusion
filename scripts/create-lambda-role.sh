#!/bin/bash
set -e

echo "🔐 Criando IAM Role para Lambda Anti-Deepfake"
echo "=============================================="

REGION="${AWS_REGION:-us-east-1}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ROLE_NAME="lambda-anti-deepfake-role"
S3_BUCKET="${S3_BUCKET:-dayfusion-bucket}"

echo "📋 Configuração:"
echo "  Region: $REGION"
echo "  Account ID: $ACCOUNT_ID"
echo "  Role Name: $ROLE_NAME"
echo "  S3 Bucket: $S3_BUCKET"
echo ""

# Trust policy para Lambda
TRUST_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF
)

# Criar role
echo "🔨 Criando IAM Role..."
if aws iam get-role --role-name $ROLE_NAME 2>/dev/null; then
  echo "⚠️  Role já existe. Pulando criação."
else
  aws iam create-role \
    --role-name $ROLE_NAME \
    --assume-role-policy-document "$TRUST_POLICY" \
    --description "Role para Lambda Anti-Deepfake - DayFusion"
  echo "✅ Role criada"
fi

# Policy customizada para S3 e logs
POLICY_DOCUMENT=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3ReadAccess",
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": "arn:aws:s3:::$S3_BUCKET/sessions/*"
    },
    {
      "Sid": "CloudWatchLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:$REGION:$ACCOUNT_ID:log-group:/aws/lambda/*"
    }
  ]
}
EOF
)

# Criar policy inline
echo ""
echo "📝 Adicionando policy inline..."
aws iam put-role-policy \
  --role-name $ROLE_NAME \
  --policy-name "${ROLE_NAME}-policy" \
  --policy-document "$POLICY_DOCUMENT"
echo "✅ Policy adicionada"

echo ""
echo "✅ IAM Role configurada com sucesso!"
echo "🔑 Role ARN: arn:aws:iam::$ACCOUNT_ID:role/$ROLE_NAME"
echo ""
echo "⏳ Aguarde 10-15 segundos antes de criar a Lambda (propagação IAM)..."

