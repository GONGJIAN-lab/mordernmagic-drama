/**
 * TikTok Minis Webhook 类型定义
 */

export interface SignatureConfig {
  secret: string;
  clientKey: string;
  headerName: string;
  algorithm: 'tiktok-minis' | string;
  checkTimestamp?: boolean;
  timestampTolerance?: number;
}

export interface WebhookDatabaseAdapter {
  isEventProcessed(eventId: string): Promise<boolean>;
  markEventProcessed(eventId: string, eventType: string, payload: string): Promise<void>;
  upsertSubscription(sub: MinisSubscription): Promise<void>;
}

export interface WebhookHandlerConfig {
  signature: SignatureConfig;
  db: WebhookDatabaseAdapter;
  verbose?: boolean;
  customHandlers?: Record<string, (payload: TikTokWebhookPayload) => Promise<void>>;
}

export interface TikTokWebhookPayload {
  event_type?: string;
  event?: string;
  event_id?: string | number;
  create_time?: string | number;
  timestamp?: string | number;
  [key: string]: any;
}

export interface MinisSubscription {
  subscriptionId: string;
  openId: string;
  skuId: string;
  orderId?: string | null;
  status: string;
  startTime?: Date | null;
  expireTime?: Date | null;
  autoRenew?: boolean;
  nextRenewTime?: Date | null;
  cancelReason?: string | null;
}
