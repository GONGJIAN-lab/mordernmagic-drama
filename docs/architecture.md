# MORDER MAGIC Drama 架构文档

## 业务背景

MORDERN MAGIC GROUP LIMITED 出品的**独立 Web 短剧 App**。用户在 TikTok 看到付费广告 → 点击进入 `drama.mordernmagic.com` → 注册/登录 → 浏览短剧列表 → 选择剧集 → 付费 $0.99/集 → 观看 → 下一集再付费。

## 核心决策

- **不要 TikTok Minis 平台**（v2.10-v2.36.2 拒审 6+ 月）
- **不要 IAP**，用 **Stripe Checkout**（独立 Web 路线）
- **不要 VePlayer/TTMinis SDK**，用原生 HTML5 `<video>`（已配 CloudFront signed URL 防盗链）
- **不试图模仿 TikTok UI**，按海外短剧 App（DramaReel/GoodShort/ReelShort）独立 Web 风格

## 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 前端 | Vue 3 + Vite + Vant UI | 轻量、移动优先 |
| 后端 | Express + Prisma + PostgreSQL | 上手快、Railway 一键起 |
| 资产存储 | AWS S3 + CloudFront signed URL | 1h TTL 防盗链 |
| 支付 | Stripe Checkout + Webhook | 成熟的 Web 支付方案 |
| 邮件 | Resend | 海外送达率好 |
| 数据回流 | TikTok Pixel | 直接灌到广告投放后台 |
| 前端部署 | Vercel | 自动 CI/CD、CDN 全球 |
| 后端部署 | Railway | 一键 Postgres + Node |

## 数据模型

```
tt_users         (id, email, createdAt)
tt_dramas        (id, title, description, coverUrl, pricePerEp, totalEps, status)
tt_drama_episodes (id, dramaId, epNumber, title, s3Key, durationSec)
tt_user_unlocks  (id, userId, dramaId, epNumber, episodeId, paymentId, amount, status)
```

完整定义见 `backend/prisma/schema.prisma`。

## 请求流（用户付费解锁一集）

```
[Browser]
  └─ POST /api/v1/auth/send-otp    → Resend 邮件
  └─ POST /api/v1/auth/verify-otp  → JWT
  └─ POST /api/v1/payment/create-checkout → Stripe Checkout URL
  └─ [Stripe Checkout 页面付款]
  └─ Stripe Webhook → POST /api/v1/payment/webhook
      └─ 验签 + 写 tt_user_unlocks
  └─ Browser 跳回 drama/:id?ep=N&paid=1
  └─ POST /api/v1/dramas/:id/episodes/:ep/play-auth
      └─ 查 unlock 记录 → 已付费返回 CloudFront signed URL
  └─ <video src=signedUrl> 播放
  └─ @ended → TikTok Pixel: CompletePayment
```

## 部署拓扑

```
                ┌─────────────┐
                │  Cloudflare │  (DNS + CDN)
                └──────┬──────┘
                       │
       ┌───────────────┼───────────────┐
       │               │               │
   drama.mordernmagic.com      api.drama.mordernmagic.com
       │                               │
       ▼                               ▼
  ┌─────────┐                    ┌──────────┐
  │ Vercel  │                    │ Railway  │
  │  (Vue)  │                    │ Express  │
  └─────────┘                    │  + PG    │
                                 └────┬─────┘
                                      │
                              ┌───────┼───────┐
                              │       │       │
                          ┌───▼┐  ┌───▼┐  ┌───▼────┐
                          │AWS │  │Strp│  │ Resend │
                          │ S3 │  │    │  │        │
                          └────┘  └────┘  └────────┘
```

## 安全模型

- **JWT**（30 天有效）做用户鉴权
- **CloudFront signed URL**（1h TTL）防视频盗链
- **Stripe webhook signature** 验证来源真实性
- **环境变量隔离**：所有 key 存 `~/.aily/workspace/.secrets/*.env`（chmod 600），不进 git
- **GitHub repo Private**：代码本身不公开

## Phase 0 完成度

- [x] Backend 12 文件（package/server/routes/services/middleware/prisma）
- [x] Frontend 16 文件（pages/components/api/utils）
- [x] 4 份文档（architecture/api/deploy/runbook）
- [x] 3 个脚本（upload-episodes / setup-aws / seed-db）
- [x] README
- [ ] Phase 1 凭证（已就位）
- [ ] Phase 2 后端实装（待启动）
- [ ] Phase 3 前端实装
- [ ] Phase 4 45 集上传
- [ ] Phase 5 部署 + E2E
