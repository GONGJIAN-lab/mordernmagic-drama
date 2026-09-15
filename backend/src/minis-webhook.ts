import { Router, Request, Response } from 'express';
import { verifyWebhookSignature } from './webhook/signature';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  const prisma = (req as any).prisma;

  // 1) 验签
  try {
    verifyWebhookSignature(req.body, req.headers as any, {
      secret: process.env.TIKTOK_WEBHOOK_SECRET || '',
      clientKey: process.env.TIKTOK_APP_ID || '',
      headerName: 'tiktok-signature',
      algorithm: 'tiktok-minis',
    });
  } catch (e: any) {
    console.error('[minis-webhook] signature failed:', e.message);
    return res.status(401).json({ code: -1, message: 'Invalid signature' });
  }

  // 2) 解析 payload
  let payload: any;
  try {
    payload = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body));
  } catch (e: any) {
    console.error('[minis-webhook] body parse error:', e.message);
    return res.status(200).json({ code: 0, message: 'success' });
  }

  const eventType = payload.event || payload.event_type;
  const tradeOrderId = payload.trade_order_id;
  console.log('[minis-webhook]', eventType, tradeOrderId);

  // 3) 处理事件
  try {
    if (eventType === 'minis.trade_order.redeem.success' && tradeOrderId && prisma) {
      const order = await prisma.minisOrder.findFirst({ where: { orderId: tradeOrderId } });
      if (!order) {
        console.error('[minis-webhook] order not found:', tradeOrderId);
      } else {
        // 更新 MinisOrder
        await prisma.minisOrder.update({
          where: { id: order.id },
          data: { status: 'success', payTime: new Date() },
        });

        // 解析 attach 拿 drama/episode 信息
        let attach: any = {};
        try { attach = order.attach ? JSON.parse(order.attach) : {}; } catch {}
        const { drama_id, episode_id, type } = attach;

        // 写 UserUnlock（iap 解锁）
        if (type === 'full') {
          await prisma.userUnlock.upsert({
            where: { openId_skuId_orderId: { openId: order.openId, skuId: order.skuId, orderId: order.orderId } },
            update: { unlockType: 'iap_full' },
            create: {
              openId: order.openId,
              skuId: order.skuId,
              orderId: order.orderId,
              dramaId: null,
              episodeId: null,
              unlockType: 'iap_full',
            },
          });
          console.log('[minis-webhook] full series unlocked for', order.openId);
        } else if (type === 'single' && episode_id) {
          await prisma.userUnlock.upsert({
            where: { openId_skuId_orderId: { openId: order.openId, skuId: order.skuId, orderId: order.orderId } },
            update: { unlockType: 'iap_single' },
            create: {
              openId: order.openId,
              skuId: order.skuId,
              orderId: order.orderId,
              dramaId: drama_id || null,
              episodeId: episode_id || null,
              unlockType: 'iap_single',
            },
          });
          console.log('[minis-webhook] episode', episode_id, 'unlocked for', order.openId);
        }
      }
    } else if (eventType === 'minis.trade_order.redeem.failed' && tradeOrderId && prisma) {
      await prisma.minisOrder.updateMany({
        where: { orderId: tradeOrderId },
        data: { status: 'failed' },
      });
    }
  } catch (e: any) {
    console.error('[minis-webhook] handler error:', e.message);
  }

  return res.status(200).json({ code: 0, message: 'success' });
});

export default router;
