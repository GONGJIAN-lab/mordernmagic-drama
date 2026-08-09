# 部署文档

## 前置条件

- AWS S3 bucket 已建（`mordernmagic-drama-media`，us-east-1）
- Stripe Test 账号开通（webhook 端点已配置）
- Resend API key（域名 mordernmagic.com 已验证）
- Vercel 账号 + GitHub 授权
- Railway 账号 + GitHub 授权
- GitHub repo `GONGJIAN-lab/mordernmagic-drama` 已建（Private）

## 本地开发

### 后端
```bash
cd backend
cp .env.example .env
# 填入真实凭证
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run dev   # http://localhost:3000
```

### 前端
```bash
cd frontend
cp .env.example .env
# 填入 VITE_API_URL=http://localhost:3000
npm install
npm run dev   # http://localhost:5173
```

## 部署流程

### 1. GitHub 推送
```bash
git init
git add .
git commit -m "v3.0 phase 0: code skeleton"
git branch -M main
git remote add origin https://github.com/GONGJIAN-lab/mordernmagic-drama.git
git push -u origin main
```

### 2. Railway 部署后端
1. https://railway.app → New Project → Deploy from GitHub
2. 选 `GONGJIAN-lab/mordernmagic-drama` repo
3. Root Directory 设 `backend`
4. 添加 PostgreSQL plugin（自动注入 `DATABASE_URL`）
5. 环境变量填入（除 `DATABASE_URL` 外的所有）：

```
NODE_ENV=production
PORT=3000
FRONTEND_URL=https://drama.mordernmagic.com
JWT_SECRET=<64位随机>
AWS_ACCESS_KEY_ID=AKIAS...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
S3_BUCKET=mordernmagic-drama-media
CLOUDFRONT_DOMAIN=...
CLOUDFRONT_KEY_PAIR_ID=...
CLOUDFRONT_PRIVATE_KEY="..."
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=noreply@mordernmagic.com
```

6. 部署后获取 Railway 域名（`https://xxx.up.railway.app`）
7. 跑 Prisma 迁移：Railway 控制台 → 服务的 Shell → `npx prisma migrate deploy`

### 3. Vercel 部署前端
1. https://vercel.com → Add New Project
2. Import `GONGJIAN-lab/mordernmagic-drama`
3. Root Directory 设 `frontend`
4. Framework Preset 选 `Vite`
5. 环境变量：

```
VITE_API_URL=https://xxx.up.railway.app
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
VITE_TIKTOK_PIXEL_ID=
```

6. Deploy

### 4. 域名绑定
**Cloudflare** → `mordernmagic.com` DNS → 加 CNAME：

| Type | Name | Target |
|------|------|--------|
| CNAME | drama | cname.vercel-dns.com |
| CNAME | api | xxx.up.railway.app |

Vercel → Project Settings → Domains → 加 `drama.mordernmagic.com`
Railway → Service → Settings → Domains → 加 `api.drama.mordernmagic.com`

### 5. Stripe Webhook 切生产端点
- Stripe Dashboard → Webhooks → 端点 URL 改 `https://api.drama.mordernmagic.com/api/v1/payment/webhook`

### 6. TikTok Pixel
- TikTok Ads Manager → Assets → Events → Web Events → Create Pixel
- 复制 Pixel ID 填到 Vercel 环境变量 `VITE_TIKTOK_PIXEL_ID`
- Redeploy Vercel

### 7. 上线验证
- [ ] https://drama.mordernmagic.com 可访问
- [ ] 短剧列表显示正常
- [ ] 详情页能打开
- [ ] OTP 登录跑通（检查 Resend dashboard 邮件日志）
- [ ] Stripe Checkout 测试卡 `4242 4242 4242 4242` 支付成功
- [ ] 付费后能看对应集
- [ ] TikTok Pixel Helper Chrome 扩展验证 `CompletePayment` 事件触发
- [ ] 后端日志有 unlock 写入记录
