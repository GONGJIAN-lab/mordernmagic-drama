#!/bin/bash
# 45 集 MP4 上传到 S3
# 用法: ./upload-episodes.sh /path/to/mp4/folder

set -e

EPISODE_DIR="${1:?Usage: $0 <episode-folder>}"
BUCKET="mordernmagic-drama-media"
PREFIX="episodes"

if [ ! -d "$EPISODE_DIR" ]; then
  echo "❌ 目录不存在: $EPISODE_DIR"
  exit 1
fi

echo "📤 上传 $EPISODE_DIR 到 s3://$BUCKET/$PREFIX/"

count=0
for f in "$EPISODE_DIR"/*.mp4; do
  if [ -f "$f" ]; then
    filename=$(basename "$f")
    # 期望命名: ep01.mp4 ep02.mp4 ... ep45.mp4
    aws s3 cp "$f" "s3://$BUCKET/$PREFIX/$filename" \
      --content-type "video/mp4" \
      --cache-control "max-age=31536000" \
      --metadata "uploaded=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "  ✓ $filename"
    count=$((count + 1))
  fi
done

echo "✅ 上传完成：$count 个文件"
echo "💡 下一步：跑 scripts/seed-db.sh 写入数据库"
