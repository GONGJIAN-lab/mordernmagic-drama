/**
 * TikTok Minis Webhook Express 路由
 * 挂载点：POST /webhook/tiktok
 *
 * 使用方式：
 *   import { createTikTokWebhookRouter } from './webhook/tiktok';
 *   app.use('/webhook', createTikTokWebhookRouter(config));
 */
import { Router } from 'express';
import type { WebhookHandlerConfig } from './types';
/**
 * 创建 TikTok Webhook 路由
 * @param config Webhook 处理器配置
 * @returns Express Router
 */
export declare function createTikTokWebhookRouter(config: WebhookHandlerConfig): Router;
export { verifyWebhookSignature, WebhookSignatureError } from './signature';
export { WebhookService } from './service';
export type { TikTokWebhookPayload, TradeOrderData, SubscriptionData, SignatureConfig, WebhookDatabaseAdapter, WebhookHandlerConfig, } from './types';
//# sourceMappingURL=tiktok.d.ts.map