/**
 * TikTok Minis Webhook 业务处理服务
 * 仅处理 subscription 事件（trade_order 已在 v2.5.0 彻底移除）
 */

import { WebhookDatabaseAdapter, TikTokWebhookPayload } from './types';

interface WebhookServiceConfig {
  db: WebhookDatabaseAdapter;
  verbose?: boolean;
}

export class WebhookService {
  private db: WebhookDatabaseAdapter;
  private verbose: boolean;

  constructor(config: WebhookServiceConfig) {
    this.db = config.db;
    this.verbose = config.verbose || false;
  }

  async handleEvent(payload: TikTokWebhookPayload): Promise<void> {
    const eventType = payload.event_type || (payload as any).event;
    const eventId = String(payload.event_id || (payload as any).create_time || (payload as any).timestamp);

    if (!eventType || !eventId) {
      throw new Error('Missing event_type or event_id in payload');
    }

    // 幂等检查
    const alreadyProcessed = await this.db.isEventProcessed(eventId);
    if (alreadyProcessed) {
      if (this.verbose) console.log(`[WebhookService] Event ${eventId} already processed, skipping`);
      return;
    }

    // 记录事件
    await this.db.markEventProcessed(eventId, eventType, JSON.stringify(payload));

    // 按事件类型分发（仅保留 subscription 事件，trade_order 已彻底移除）
    switch (eventType) {
      case 'subscription.created':
      case 'subscription.activated':
        await this.handleSubscriptionCreated(payload);
        break;
      case 'subscription.renewed':
        await this.handleSubscriptionRenewed(payload);
        break;
      case 'subscription.cancelled':
        await this.handleSubscriptionCancelled(payload);
        break;
      case 'subscription.expired':
        await this.handleSubscriptionExpired(payload);
        break;
      case 'tiktok.ping':
        if (this.verbose) console.log('[WebhookService] Received ping event');
        break;
      default:
        if (this.verbose) console.log(`[WebhookService] Unhandled event type: ${eventType}`);
    }
  }

  private async handleSubscriptionCreated(payload: TikTokWebhookPayload): Promise<void> {
    const data = payload.data || payload;
    const sub = {
      subscriptionId: data.subscription_id || '',
      openId: data.open_id || '',
      skuId: data.tier_id || data.sku_id || '',
      status: 'active',
      startTime: data.begin_time ? new Date(data.begin_time) : new Date(),
      expireTime: data.end_time ? new Date(data.end_time) : null,
      autoRenew: data.is_renewal_normal !== false,
      nextRenewTime: data.next_deduct_time ? new Date(data.next_deduct_time) : null,
      cancelReason: null,
    };

    if (!sub.subscriptionId || !sub.openId) {
      console.error('[WebhookService] handleSubscriptionCreated: missing subscriptionId or openId', data);
      return;
    }

    await this.db.upsertSubscription(sub);

    if (this.verbose) console.log(`[WebhookService] Subscription created: ${sub.subscriptionId}`);
  }

  private async handleSubscriptionRenewed(payload: TikTokWebhookPayload): Promise<void> {
    const data = payload.data || payload;
    const sub = {
      subscriptionId: data.subscription_id || '',
      openId: data.open_id || '',
      skuId: data.tier_id || data.sku_id || '',
      status: 'active',
      startTime: data.begin_time ? new Date(data.begin_time) : null,
      expireTime: data.end_time ? new Date(data.end_time) : null,
      autoRenew: data.is_renewal_normal !== false,
      nextRenewTime: data.next_deduct_time ? new Date(data.next_deduct_time) : null,
      cancelReason: null,
    };

    if (!sub.subscriptionId) {
      console.error('[WebhookService] handleSubscriptionRenewed: missing subscriptionId', data);
      return;
    }

    await this.db.upsertSubscription(sub);
    if (this.verbose) console.log(`[WebhookService] Subscription renewed: ${sub.subscriptionId}`);
  }

  private async handleSubscriptionCancelled(payload: TikTokWebhookPayload): Promise<void> {
    const data = payload.data || payload;
    const subId = data.subscription_id || '';
    const openId = data.open_id || '';
    const skuId = data.tier_id || data.sku_id || '';

    if (!subId) {
      console.error('[WebhookService] handleSubscriptionCancelled: missing subscriptionId', data);
      return;
    }

    await this.db.upsertSubscription({
      subscriptionId: subId,
      openId,
      skuId,
      status: 'cancelled',
      startTime: null,
      expireTime: data.actually_end_time ? new Date(data.actually_end_time) : null,
      autoRenew: false,
      nextRenewTime: null,
      cancelReason: data.cancel_reason || 'user_cancelled',
    });

    if (this.verbose) console.log(`[WebhookService] Subscription cancelled: ${subId}`);
  }

  private async handleSubscriptionExpired(payload: TikTokWebhookPayload): Promise<void> {
    const data = payload.data || payload;
    const subId = data.subscription_id || '';
    const openId = data.open_id || '';
    const skuId = data.tier_id || data.sku_id || '';

    if (!subId) {
      console.error('[WebhookService] handleSubscriptionExpired: missing subscriptionId', data);
      return;
    }

    await this.db.upsertSubscription({
      subscriptionId: subId,
      openId,
      skuId,
      status: 'expired',
      startTime: null,
      expireTime: new Date(),
      autoRenew: false,
      nextRenewTime: null,
      cancelReason: 'expired',
    });

    if (this.verbose) console.log(`[WebhookService] Subscription expired: ${subId}`);
  }
}
