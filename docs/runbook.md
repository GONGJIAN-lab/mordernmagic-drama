# Runbook - 日常运维

## 监控指标

- **Vercel Analytics**：PV / 跳出率 / 加载耗时
- **Railway Metrics**：API 响应时间 / 错误率 / CPU
- **Stripe Dashboard**：每日交易额 / 失败率
- **S3 流量**：每月 egress 费用（重点）
- **Resend 邮件日志**：送达率 / 投诉率

## 常见问题

### 1. 视频加载慢 / 黑屏
- 检查 CloudFront 缓存命中率（应 > 90%）
- 确认 signed URL 1h TTL 未过期
- S3 bucket 公开访问是否被误开（应保持 Block All）

### 2. Stripe Webhook 失败
- Stripe Dashboard → Webhooks → 查看失败事件
- 检查 `STRIPE_WEBHOOK_SECRET` 是否对应 test/live 模式
- Railway 日志搜索 `Webhook signature verification failed`

### 3. 用户 OTP 收不到
- Resend Dashboard → Logs → 查 email 是否发出
- 检查 `_dmarc` TXT 记录是否在 Cloudflare 配置
- 检查发件域名是否 verified

### 4. TikTok Pixel 事件未触发
- 安装 TikTok Pixel Helper Chrome 扩展
- 访问页面看是否识别到 Pixel
- 付费完成后看 Network 请求 `https://analytics.tiktok.com/i18n/pixel/events.js`

### 5. 数据库连接失败
- Railway Postgres 状态：是否 paused（免费版会休眠）
- 重启服务：Railway → Service → Restart
- 检查 `DATABASE_URL` 是否注入

## 紧急操作

### 回滚
```bash
# Vercel: Dashboard → Deployments → 选上一版 → Promote to Production
# Railway: Deployments → 选上一版 → Redeploy
```

### 重置数据库（慎用）
```bash
# Railway 控制台 Shell
npx prisma migrate reset
# 会清空所有数据 + 重新跑迁移 + 跑 seed
```

### 强制续签 Stripe Webhook Secret
1. Stripe Dashboard → Webhooks → 端点 → Roll secret
2. 新值贴到 Railway 环境变量
3. Railway 自动 redeploy

### 暂停服务（余额预警）
- Vercel → Project → Settings → Danger Zone → Pause
- Railway → Service → 右上角 → Disable

## 关键数据备份

### 数据库
Railway Postgres 自动每日备份（Pro 计划），免费版需手动：

```bash
# 在本地
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql
```

### S3 视频源文件
保持本地有完整 mp4 备份（S3 不做版本控制）

## 告警阈值

- 5xx 错误率 > 5% 持续 5 分钟 → 飞书告警
- Stripe Webhook 失败 > 3 次/小时 → 飞书告警
- 视频加载 P95 > 5s → 飞书告警
- DB 连接数 > 80% → 飞书告警
