# MORDER MAGIC Drama Platform

> MORDERN MAGIC GROUP LIMITED 出品的独立 Web 短剧 App

短剧付费 + TikTok 广告引流的 MVP 平台。

## 项目结构

```
mordernmagic-drama/
├── frontend/                # Vue 3 + Vite + Vant
│   ├── src/
│   │   ├── pages/           # DramaList / DramaDetail / Player
│   │   ├── components/      # VideoPlayer / LockMask / EpisodeDrawer
│   │   ├── api/             # axios client
│   │   └── utils/           # formatCount / tiktok-pixel
│   ├── vercel.json
│   └── package.json
├── backend/                 # Express + Prisma + PostgreSQL
│   ├── src/
│   │   ├── routes/          # drama / payment / auth
│   │   ├── services/        # s3 (CloudFront signed URL)
│   │   ├── middleware/      # auth / error
│   │   └── db/              # Prisma client
│   ├── prisma/schema.prisma
│   └── package.json
├── scripts/                 # 运维脚本
│   ├── upload-episodes.sh
│   ├── setup-aws.sh
│   └── seed-db.sh
├── docs/                    # 4 份文档
│   ├── architecture.md
│   ├── api.md
│   ├── deploy.md
│   └── runbook.md
└── README.md
```

## 快速开始

```bash
# 后端
cd backend
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate dev
npm run dev

# 前端（另一个终端）
cd frontend
cp .env.example .env
npm install
npm run dev
```

后端跑在 http://localhost:3000，前端跑在 http://localhost:5173

## 部署

详见 [`docs/deploy.md`](docs/deploy.md)。

## 关键链接

- **生产域名**：https://drama.mordernmagic.com
- **API**：https://api.drama.mordernmagic.com
- **Vercel Dashboard**：https://vercel.com/dashboard
- **Railway Dashboard**：https://railway.app/dashboard
- **Stripe Dashboard**：https://dashboard.stripe.com
- **AWS S3 Console**：https://s3.console.aws.amazon.com
- **Resend Dashboard**：https://resend.com/dashboard

## 业务信息

- **公司**：MORDERN MAGIC GROUP LIMITED（美国怀俄明州）
- **首批短剧**：《穿进虐文，五个儿媳我来宠》45 集
- **单价**：$0.99 / 集（$44.55 / 全套）
- **支付方式**：Stripe Checkout
- **目标市场**：全球（TikTok 广告引流）
- **邮箱前缀**：noreply@mordernmagic.com

## 文档

- [架构文档](docs/architecture.md)
- [API 文档](docs/api.md)
- [部署文档](docs/deploy.md)
- [运维手册](docs/runbook.md)

## License

Private - MORDERN MAGIC GROUP LIMITED
