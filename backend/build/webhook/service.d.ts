/**
 * TikTok Minis Webhook 业务处理服务
 * 处理 6 种事件：支付成功/失败、订阅创建/续费/取消/过期
 */
import type { TikTokWebhookPayload, WebhookDatabaseAdapter } from './types';
export interface WebhookServiceOptions {
    db: WebhookDatabaseAdapter;
    verbose?: boolean;
}
export declare class WebhookService {
    private db;
    private verbose;
    constructor(opts: WebhookServiceOptions);
    private log;
    handleEvent(payload: TikTokWebhookPayload): Promise<void>;
    private handleTradeOrderSuccess;
    private handleTradeOrderFail;
    private handleSubscriptionCreate;
    private handleSubscriptionRenew;
    private handleSubscriptionCancel;
    private handleSubscriptionExpire;
}
//# sourceMappingURL=service.d.ts.map