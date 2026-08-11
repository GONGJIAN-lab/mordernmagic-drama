/**
 * TikTok Minis Webhook 类型定义
 * 基于官方事件类型，支持扩展
 */
export interface TikTokWebhookPayload {
    /** 事件类型，如 minis.trade_order.redeem.success */
    event_type: string;
    /** 事件唯一标识，用于幂等去重 */
    event_id: string;
    /** 时间戳（秒） */
    timestamp: number;
    /** 事件业务数据 */
    data: TradeOrderData | SubscriptionData;
}
export interface TradeOrderData {
    /** TikTok 订单号 */
    order_id: string;
    /** 开发者侧订单号（创建订单时传入） */
    out_order_no?: string;
    /** 用户 OpenID */
    open_id: string;
    /** 购买的商品/剧集 SKU ID */
    sku_id: string;
    /** 购买数量 */
    quantity: number;
    /** 支付金额（分） */
    total_amount: number;
    /** 币种 */
    currency: string;
    /** 订单状态 */
    status: 'success' | 'fail';
    /** 失败原因（仅 fail 事件） */
    fail_reason?: string;
    /** 支付时间 */
    pay_time?: number;
    /** 附加数据（创建订单时传入） */
    attach?: string;
}
export interface SubscriptionData {
    /** 订阅 ID */
    subscription_id: string;
    /** 用户 OpenID */
    open_id: string;
    /** 订阅套餐 SKU ID */
    sku_id: string;
    /** 订阅状态 */
    status: 'active' | 'cancelled' | 'expired';
    /** 订阅开始时间 */
    start_time: number;
    /** 订阅过期时间 */
    expire_time?: number;
    /** 自动续费是否开启 */
    auto_renew: boolean;
    /** 下次续费时间 */
    next_renew_time?: number;
    /** 取消原因（仅 cancel 事件） */
    cancel_reason?: string;
}
export interface SignatureConfig {
    /** 签名密钥（从 TikTok 后台获取的 webhook secret） */
    secret: string;
    /** Client Key / App Key */
    clientKey: string;
    /** 签名 header 名称，默认 X-TikTok-Signature */
    headerName?: string;
    /** 签名算法：hmac-sha256 | hmac-sha256-hex | raw-body-hmac-sha256 */
    algorithm?: 'tiktok-shop' | 'hmac-sha256' | 'hmac-sha256-hex' | 'raw-body-hmac-sha256' | 'tiktok-minis';
    /** 是否校验时间戳防重放（默认 true） */
    checkTimestamp?: boolean;
    /** 时间戳容忍范围（秒，默认 300 = 5分钟） */
    timestampTolerance?: number;
}
export interface WebhookDatabaseAdapter {
    /**
     * 幂等检查：查询 event_id 是否已处理
     */
    isEventProcessed(eventId: string): Promise<boolean>;
    /**
     * 标记事件为已处理
     */
    markEventProcessed(eventId: string, eventType: string, payload: string): Promise<void>;
    /**
     * 创建或更新订单记录
     */
    upsertOrder(order: {
        orderId: string;
        outOrderNo?: string;
        openId: string;
        skuId: string;
        quantity: number;
        totalAmount: number;
        currency: string;
        status: string;
        payTime?: Date;
        attach?: string;
        failReason?: string;
    }): Promise<void>;
    /**
     * 创建或更新订阅记录
     */
    upsertSubscription(sub: {
        subscriptionId: string;
        openId: string;
        skuId: string;
        status: string;
        startTime: Date;
        expireTime?: Date;
        autoRenew: boolean;
        nextRenewTime?: Date;
        cancelReason?: string;
    }): Promise<void>;
    /**
     * 发货：解锁用户剧集权益
     * @param openId 用户 ID
     * @param skuId  购买的 SKU（对应剧集或套餐）
     * @param orderId 订单号（用于幂等）
     */
    deliverContent(openId: string, skuId: string, orderId: string): Promise<void>;
    /**
     * 取消用户权益（退款/订阅取消时）
     */
    revokeContent?(openId: string, skuId: string, reason: string): Promise<void>;
}
export interface WebhookHandlerConfig {
    /** 签名验证配置 */
    signature: SignatureConfig;
    /** 数据库适配器 */
    db: WebhookDatabaseAdapter;
    /** 是否启用详细日志 */
    verbose?: boolean;
    /** 自定义事件处理器（覆盖默认逻辑） */
    customHandlers?: Partial<Record<string, (payload: TikTokWebhookPayload) => Promise<void>>>;
}
//# sourceMappingURL=types.d.ts.map