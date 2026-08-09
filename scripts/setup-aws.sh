#!/bin/bash
# 创建 S3 bucket + CloudFront 分发（首次部署用）
# 用法: ./setup-aws.sh

set -e

BUCKET="mordernmagic-drama-media"
REGION="us-east-1"

echo "🔧 创建 S3 bucket: $BUCKET"
aws s3 mb "s3://$BUCKET" --region "$REGION" || echo "Bucket 已存在"

echo "🔒 锁定公共访问"
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

echo "🌐 创建 CloudFront 分发..."
DIST=$(aws cloudfront create-distribution --origin-domain-name "$BUCKET.s3.$REGION.amazonaws.com" \
  --default-root-object "" \
  --enabled \
  --query "Distribution.{Id:Id,Domain:DomainName}" --output json 2>&1)

DIST_ID=$(echo "$DIST" | python3 -c "import sys,json;print(json.load(sys.stdin)['Id'])")
DIST_DOMAIN=$(echo "$DIST" | python3 -c "import sys,json;print(json.load(sys.stdin)['Domain'])")

echo "✅ CloudFront ID: $DIST_ID"
echo "✅ CloudFront Domain: $DIST_DOMAIN"
echo "💡 等部署完成（15-30 分钟）后填到 Railway:"
echo "   CLOUDFRONT_DOMAIN=$DIST_DOMAIN"
echo ""
echo "💡 下一步：到 AWS Console 创建 Key Pair for signed URLs:"
echo "   1. https://console.aws.amazon.com/cloudfront/v4/home#/public-key 选 $DIST_ID"
echo "   2. Create Key Group → 拿 Key Pair ID"
echo "   3. 下载 Private Key → 填 CLOUDFRONT_PRIVATE_KEY"
