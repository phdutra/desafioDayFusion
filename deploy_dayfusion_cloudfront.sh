#!/usr/bin/env bash
set -euo pipefail

AWS_PROFILE="default"
REGION="us-east-1"
BUCKET="dayfusion-frontend"
DIST_ID="E3BF4NGDU3VKF5"
ACCOUNT_ID="405234571075"
APP_DIST_DIR="frontend/dist/frontend/browser"
API_DOMAIN="dayfusion-api-env.eba-praptpxx.us-east-1.elasticbeanstalk.com"
API_ORIGIN_ID="dayfusion-api-origin"
CACHE_POLICY_ID="4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # Managed-CachingDisabled
ORIGIN_REQUEST_POLICY_ID="b689b0a8-53d0-40ab-baf2-68738e2966ac" # Managed-AllViewerExceptHostHeader

export AWS_PROFILE
export AWS_DEFAULT_REGION="$REGION"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq não encontrado. Instale antes de continuar (ex.: brew install jq)."
  exit 1
fi

echo "## 1) Sync build para S3"
if [ -d "$APP_DIST_DIR" ]; then
  aws s3 sync "$APP_DIST_DIR/" "s3://$BUCKET/" --acl private --delete
else
  echo "Diretório de build não encontrado, pulando..."
fi

OAC_NAME="oac-$BUCKET"
OAC_ID=$(aws cloudfront list-origin-access-controls --query "OriginAccessControlList.Items[?Name && contains(Name, '$BUCKET')].Id | [0]" --output text || true)

if [ -z "$OAC_ID" ] || [ "$OAC_ID" == "None" ]; then
  CREATE_OAC_OUT=$(aws cloudfront create-origin-access-control --origin-access-control-config "Name=$OAC_NAME,Description=OAC for $BUCKET,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3" --output json)
  OAC_ID=$(echo "$CREATE_OAC_OUT" | jq -r '.OriginAccessControl.Id')
  echo "OAC criado: $OAC_ID"
else
  echo "OAC existente reutilizado: $OAC_ID"
fi

DIST_ARN="arn:aws:cloudfront::${ACCOUNT_ID}:distribution/${DIST_ID}"
read -r -d '' BUCKET_POLICY <<EOF || true
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontServicePrincipalReadOnly",
      "Effect": "Allow",
      "Principal": { "Service": "cloudfront.amazonaws.com" },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::${BUCKET}/*",
      "Condition": { "StringEquals": { "AWS:SourceArn": "${DIST_ARN}" } }
    }
  ]
}
EOF

echo "$BUCKET_POLICY" > /tmp/${BUCKET}_policy.json
aws s3api put-bucket-policy --bucket "$BUCKET" --policy file:///tmp/${BUCKET}_policy.json

get_out=$(aws cloudfront get-distribution-config --id "$DIST_ID")
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

ORIGIN_INDEX=$(jq -r --arg domain "${BUCKET}.s3.${REGION}.amazonaws.com" '[.Origins.Items | to_entries[] | select(.value.DomainName == $domain) | .key][0] // empty' /tmp/dist-config.step1.json)
if [ -z "$ORIGIN_INDEX" ]; then ORIGIN_INDEX=0; fi

jq --argjson idx "$ORIGIN_INDEX" --arg oac "$OAC_ID" '.Origins.Items[$idx] |= (. + { "OriginAccessControlId": $oac })' /tmp/dist-config.step1.json > /tmp/dist-config.step2.json

python3 <<PY
import json
from copy import deepcopy

api_domain = "${API_DOMAIN}"
api_origin_id = "${API_ORIGIN_ID}"
cache_policy_id = "${CACHE_POLICY_ID}"
origin_request_policy_id = "${ORIGIN_REQUEST_POLICY_ID}"

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

with open("/tmp/dist-config.step4.json", "w") as f:
    json.dump(config, f)
PY

aws cloudfront update-distribution --id "$DIST_ID" --if-match "$ETAG" --distribution-config file:///tmp/dist-config.step4.json

aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*"

echo "Deploy do front concluído. Domínio CloudFront: https://${DIST_ID}.cloudfront.net"
