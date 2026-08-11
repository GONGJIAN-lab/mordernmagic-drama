/**
 * TikTok Minis Webhook 业务处理服务
 * 处理 6 种事件：支付成功/失败、订阅创建/续费/取消/过期
 */

import type {
  TikTokWebhookPayload,
  TradeOrderData,
  SubscriptionData,
  WebhookDatabaseAdapter,
} from './types';

export interface WebhookServiceOptions {
  db: WebhookDatabaseAdapter;
  verbose?: boolean;
}

export class WebhookService {
  private db: WebhookDatabaseAdapter;
  private verbose: boolean;

  constructor(opts: WebhookServiceOptions) {
    this.db = opts.db;
    this.verbose = opts.verbose ?? false;
  }

  private log(...args: unknown[]) {
    if (this.verbose) {
      console.log('[TikTokWebhook]', ...args);
    }
  }

  // ============================================================
  // 事件分发入口
  // ============================================================

  async handleEvent(payload: TikTokWebhookPayload): Promise<void> {
    const { event_type, event_id } = payload;
    this.log('Received event:', event_type, 'event_id:', event_id);

    // 1. 幂等检查
    const isProcessed = await this.db.isEventProcessed(event_id);
    if (isProcessed) {
      this.log('Event already processed, skipping:', event_id);
      return;
    }

    // 2. 按事件类型处理
    switch (event_type) {
      case 'minis.trade_order.redeem.success':
        await this.handleTradeOrderSuccess(payload.data as TradeOrderData);
        break;
      case 'minis.trade_order.redeem.fail':
        await this.handleTradeOrderFail(payload.data as TradeOrderData);
        break;
      case 'minis.subscription.create':
        await this.handleSubscriptionCreate(payload.data as SubscriptionData);
        break;
      case 'minis.subscription.renew':
        await this.handleSubscriptionRenew(payload.data as SubscriptionData);
        break;
      case 'minis.subscription.cancel':
        await this.handleSubscriptionCancel(payload.data as SubscriptionData);
        break;
      case 'minis.subscription.expire':
        await this.handleSubscriptionExpire(payload.data as SubscriptionData);
        break;
      default:
        this.log('Unknown event type, skipping:', event_type);
        return;
    }

    // 3. 标记为已处理
    await this.db.markEventProcessed(event_id, event_type, JSON.stringify(payload));
    this.log('Event processed successfully:', event_id);
  }

  // ============================================================
  // 支付成功：更新订单 + 发货（解锁剧集）
  // ============================================================

  private async handleTradeOrderSuccess(data: TradeOrderData): Promise<void> {
    this.log('Processing trade_order success:', data.order_id);

    // 1. 保存/更新订单
    await this.db.upsertOrder({
      orderId: data.order_id,
      outOrderNo: data.out_order_no,
      openId: data.open_id,
      skuId: data.sku_id,
      quantity: data.quantity,
      totalAmount: data.total_amount,
      currency: data.currency,
      status: 'PAID',
      payTime: data.pay_time ? new Date(data.pay_time * 1000) : new Date(),
      attach: data.attach,
    });

    // 2. 发货：解锁用户权益
    await this.db.deliverContent(data.open_id, data.sku_id, data.order_id);

    this.log('Trade order success processed:', data.order_id);
  }

  // ============================================================
  // 支付失败：更新订单状态，记录失败原因
  // ============================================================

  private async handleTradeOrderFail(data: TradeOrderData): Promise<void> {
    this.log('Processing trade_order fail:', data.order_id, 'reason:', data.fail_reason);

    await this.db.upsertOrder({
      orderId: data.order_id,
      outOrderNo: data.out_order_no,
      openId: data.open_id,
      skuId: data.sku_id,
      quantity: data.quantity,
      totalAmount: data.total_amount,
      currency: data.currency,
      status: 'FAILED',
      failReason: data.fail_reason,
      attach: data.attach,
    });

    this.log('Trade order fail processed:', data.order_id);
  }

  // ============================================================
  // 订阅创建：保存订阅记录 + 开通权益
  // ============================================================

  private async handleSubscriptionCreate(data: SubscriptionData): Promise<void> {
    this.log('Processing subscription create:', data.subscription_id);

    await this.db.upsertSubscription({
      subscriptionId: data.subscription_id,
      openId: data.open_id,
      skuId: data.sku_id,
      status: data.status,
      startTime: new Date(data.start_time * 1000),
      expireTime: data.expire_time ? new Date(data.expire_time * 1000) : undefined,
      autoRenew: data.auto_renew,
      nextRenewTime: data.next_renew_time ? new Date(data.next_renew_time * 1000) : undefined,
    });

    // 订阅创建即开通全部权益
    await this.db.deliverContent(data.open_id, data.sku_id, data.subscription_id);

    this.log('Subscription create processed:', data.subscription_id);
  }

  // ============================================================
  // 订阅续费：更新过期时间
  // ============================================================

  private async handleSubscriptionRenew(data: SubscriptionData): Promise<void> {
    this.log('Processing subscription renew:', data.subscription_id);

    await this.db.upsertSubscription({
      subscriptionId: data.subscription_id,
      openId: data.open_id,
      skuId: data.sku_id,
      status: data.status,
      startTime: new Date(data.start_time * 1000),
      expireTime: data.expire_time ? new Date(data.expire_time * 1000) : undefined,
      autoRenew: data.auto_renew,
      nextRenewTime: data.next_renew_time ? new Date(data.next_renew_time * 1000) : undefined,
    });

    this.log('Subscription renew processed:', data.subscription_id);
  }

  // ============================================================
  // 订阅取消：更新状态，可选回收权益
  // ============================================================

  private async handleSubscriptionCancel(data: SubscriptionData): Promise<void> {
    this.log('Processing subscription cancel:', data.subscription_id, 'reason:', data.cancel_reason);

    await this.db.upsertSubscription({
      subscriptionId: data.subscription_id,
      openId: data.open_id,
      skuId: data.sku_id,
      status: 'CANCELLED',
      startTime: new Date(data.start_time * 1000),
      expireTime: data.expire_time ? new Date(data.expire_time * 1000) : undefined,
      autoRenew: false,
      cancelReason: data.cancel_reason,
    });

    // 可选：如果业务要求取消立即回收权益，调用 revokeContent
    if (this.db.revokeContent) {
      await this.db.revokeContent(data.open_id, data.sku_id, data.cancel_reason || 'subscription_cancelled');
    }

    this.log('Subscription cancel processed:', data.subscription_id);
  }

  // ============================================================
  // 订阅过期：更新状态，回收权益
  // ============================================================

  private async handleSubscriptionExpire(data: SubscriptionData): Promise<void> {
    this.log('Processing subscription expire:', data.subscription_id);

    await this.db.upsertSubscription({
      subscriptionId: data.subscription_id,
      openId: data.open_id,
      skuId: data.sku_id,
      status: 'EXPIRED',
      startTime: new Date(data.start_time * 1000),
      expireTime: data.expire_time ? new Date(data.expire_time * 1000) : undefined,
      autoRenew: false,
    });

    // 过期时回收权益
    if (this.db.revokeContent) {
      await this.db.revokeContent(data.open_id, data.sku_id, 'subscription_expired');
    }

    this.log('Subscription expire processed:', data.subscription_id);
  }
}
