# API 文档

**Base URL**: `https://api.drama.mordernmagic.com/api/v1`（生产） / `http://localhost:3000/api/v1`（开发）

**Auth**: 除 `auth/*` 和 `dramas` 列表外，其他需要 `Authorization: Bearer <JWT>`

## 鉴权

### POST /auth/send-otp
发送 6 位验证码到邮箱

**Request**
```json
{ "email": "user@example.com" }
```

**Response 200**
```json
{ "data": { "sent": true } }
```

### POST /auth/verify-otp
验证 OTP，签发 30 天 JWT

**Request**
```json
{ "email": "user@example.com", "otp": "123456" }
```

**Response 200**
```json
{
  "data": {
    "token": "eyJ...",
    "user": { "id": "clx...", "email": "user@example.com" }
  }
}
```

## 短剧

### GET /dramas
**Response 200**
```json
{
  "data": [
    {
      "id": "clx...",
      "title": "穿进虐文，五个儿媳我来宠",
      "description": "现代女主穿进古言虐文...",
      "coverUrl": "https://...",
      "pricePerEp": "0.99",
      "totalEps": 45
    }
  ]
}
```

### GET /dramas/:id
**Response 200**
```json
{
  "data": {
    "id": "clx...",
    "title": "穿进虐文，五个儿媳我来宠",
    "totalEps": 45,
    "pricePerEp": "0.99",
    "episodes": [
      { "id": "clx...", "epNumber": 1, "title": "穿越", "durationSec": 180 }
    ]
  }
}
```

### POST /dramas/:id/episodes/:epNumber/play-auth
**Auth**: Required

**Response 200**（已付费）
```json
{
  "data": {
    "playUrl": "https://d111111abcdef8.cloudfront.net/episodes/ep01.mp4?Expires=...&Signature=...",
    "duration": 180,
    "episodeId": "clx..."
  }
}
```

**Response 402**（未付费）
```json
{ "error": "payment_required", "episodeId": "clx..." }
```

## 支付

### POST /payment/create-checkout
**Auth**: Required

**Request**
```json
{ "dramaId": "clx...", "epNumber": 2 }
```

**Response 200**
```json
{
  "data": {
    "sessionId": "cs_test_...",
    "url": "https://checkout.stripe.com/c/pay/cs_test_..."
  }
}
```

### POST /payment/webhook
**Stripe only** — 验签 `Stripe-Signature` header

**监听事件**: `checkout.session.completed`

写入 `tt_user_unlocks` 记录（幂等 via `paymentId` 唯一索引）。

## 错误码

| Code | 含义 |
|---|---|
| 400 | 参数错误 |
| 401 | 未登录 / token 无效 |
| 402 | 需付费 |
| 404 | 资源不存在 |
| 500 | 服务器错误 |

## 限流（待加）

Phase 1 不限流，Phase 2 加 Upstash Redis 限流中间件。
