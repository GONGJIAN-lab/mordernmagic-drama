/**
 * 集成示例：如何在现有 Express 后端挂载 TikTok Webhook
 *
 * 假设你的 backend/src/index.ts 已有一个 Express app，
 * 只需在合适位置插入以下代码。
 */

import express from 'express';
import { createTikTokWebhookRouter } from './webhook/tiktok';
import type { WebhookDatabaseAdapter } from './webhook/tiktok';

const app = express();

// ============================================================
// 关键：Webhook 路由必须在 express.json() 之前挂载，
// 因为验签需要原始 body（Buffer），不能被 JSON parser 改写。
// ============================================================

// 1. 为 webhook 路径单独启用 raw body parser
app.use('/webhook/tiktok', express.raw({ type: 'application/json' }));

// 2. 创建数据库适配器（以下为示例，请替换为你实际使用的 ORM）
const dbAdapter: WebhookDatabaseAdapter = {
  async isEventProcessed(eventId: string) {
    // TODO: 替换为实际查询，例如：
    // return !!(await prisma.webhookEvent.findUnique({ where: { eventId } }));
    return false;
  },

  async markEventProcessed(eventId: string, eventType: string, payload: string) {
    // TODO: 替换为实际写入，例如：
    // await prisma.webhookEvent.create({ data: { eventId, eventType, payload, processedAt: new Date() } });
    console.log('Mark processed:', eventId, eventType);
  },

  async upsertOrder(order) {
    // TODO: 替换为实际订单 upsert，例如：
    // await prisma.order.upsert({ where: { orderId: order.orderId }, create: order, update: order });
    console.log('Upsert order:', order.orderId);
  },

  async upsertSubscription(sub) {
    // TODO: 替换为实际订阅 upsert
    console.log('Upsert subscription:', sub.subscriptionId);
  },

  async deliverContent(openId: string, skuId: string, orderId: string) {
    // TODO: 替换为实际发货逻辑，例如：
    // - 根据 skuId 解析出对应剧集/套餐
    // - 在 user_unlocks 表中插入记录
    // - 或者给用户加积分/加时长
    console.log('Deliver content:', openId, skuId, orderId);
  },

  async revokeContent(openId: string, skuId: string, reason: string) {
    // TODO: 替换为实际回收权益逻辑（订阅取消/过期时）
    console.log('Revoke content:', openId, skuId, reason);
  },
};

// 3. 挂载 Webhook 路由
app.use(
  '/webhook',
  createTikTokWebhookRouter({
    signature: {
      secret: process.env.TIKTOK_WEBHOOK_SECRET || '',
      headerName: 'x-tiktok-signature',   // 如果 TikTok 后台用的 header 名不同，改这里
      algorithm: 'hmac-sha256-hex',       // 如果签名算法不同，改这里
      checkTimestamp: true,
      timestampTolerance: 300,
    },
    db: dbAdapter,
    verbose: process.env.NODE_ENV !== 'production',
  })
);

// 4. 其他路由继续使用 express.json()
app.use(express.json());

// ============================================================
// Railway 健康检查（保留现有逻辑）
// ============================================================
app.get('/', (_req, res) => res.json({ status: 'ok' }));

// ... 其他现有路由 ...

app.listen(process.env.PORT || 3000, () => {
  console.log('Server running on port', process.env.PORT || 3000);
});
