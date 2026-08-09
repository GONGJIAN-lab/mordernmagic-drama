#!/bin/bash
# 把第一部短剧写入数据库（45 集）
# 用法: ./seed-db.sh

set -e

echo "🌱 写入 seed 数据..."

cd "$(dirname "$0")/../backend"

if [ ! -f .env ]; then
  echo "❌ 找不到 backend/.env，先 cp .env.example .env"
  exit 1
fi

set -a; source .env; set +a

node src/db/seed.js

echo "✅ Seed 完成"
echo "💡 验证: psql $DATABASE_URL -c 'SELECT count(*) FROM tt_drama_episodes;'"
