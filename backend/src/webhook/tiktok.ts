/**
 * TikTok Minis Webhook Express 路由
 * 挂载点：POST /webhook/tiktok
 *
 * 使用方式：
 *   import { createTikTokWebhookRouter } from './webhook/tiktok';
 *   app.use('/webhook', createTikTokWebhookRouter(config));
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { verifyWebhookSignature, WebhookSignatureError } from './signature';
import { WebhookService } from './service';
import type { WebhookHandlerConfig, TikTokWebhookPayload } from './types';

/**
 * 创建 TikTok Webhook 路由
 * @param config Webhook 处理器配置
 * @returns Express Router
 */
export function createTikTokWebhookRouter(config: WebhookHandlerConfig): Router {
  const router = Router();
  const service = new WebhookService({ db: config.db, verbose: config.verbose });

  // 必须使用 raw body 才能正确验签（JSON parser 会改变 body 格式）
  // 在挂载此路由前，确保该路径不使用 express.json() 中间件
  router.post('/tiktok', async (req: Request, res: Response, _next: NextFunction) => {
    const rawBody = req.body as Buffer;

    // 安全校验 1：必须是 Buffer（原始字节）
    if (!Buffer.isBuffer(rawBody)) {
      console.error('[TikTokWebhook] req.body is not a Buffer. Make sure you use express.raw({ type: "application/json" }) before this router.');
      res.status(400).json({ error: 'Invalid body format' });
      return;
    }

    try {
      // 安全校验 2：签名验证
      verifyWebhookSignature(rawBody, req.headers as Record<string, string | string[] | undefined>, config.signature);
    } catch (err) {
      if (err instanceof WebhookSignatureError) {
        console.warn('[TikTokWebhook] Signature verification failed:', err.message);
        res.status(401).json({ error: 'Unauthorized', message: err.message });
        return;
      }
      throw err;
    }

    // 安全校验 3：解析 JSON
    let payload: TikTokWebhookPayload;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as TikTokWebhookPayload;
    } catch {
      res.status(400).json({ error: 'Invalid JSON' });
      return;
    }

    // 安全校验 4：字段基本校验
    if (!payload.event_type || !payload.event_id) {
      res.status(400).json({ error: 'Missing event_type or event_id' });
      return;
    }

    // 检查是否有自定义处理器
    const customHandler = config.customHandlers?.[payload.event_type];
    if (customHandler) {
      try {
        await customHandler(payload);
      } catch (err) {
        console.error('[TikTokWebhook] Custom handler error:', err);
        // 自定义处理器出错也返回 200，避免 TikTok 重试导致副作用
        // 但记录错误供排查
      }
      res.status(200).send('OK');
      return;
    }

    // 默认业务处理
    try {
      await service.handleEvent(payload);
      res.status(200).send('OK');
    } catch (err) {
      console.error('[TikTokWebhook] Business processing error:', err);
      // 业务处理出错也返回 200，因为幂等检查保证重试不会重复发货
      // 但把错误记到日志，供人工排查
      res.status(200).send('OK');
    }
  });

  return router;
}

// 导出子模块，方便用户按需使用
export { verifyWebhookSignature, WebhookSignatureError } from './signature';
export { WebhookService } from './service';
export type {
  TikTokWebhookPayload,
  TradeOrderData,
  SubscriptionData,
  SignatureConfig,
  WebhookDatabaseAdapter,
  WebhookHandlerConfig,
} from './types';
