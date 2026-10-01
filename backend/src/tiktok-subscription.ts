/**
 * TikTok Minis Subscription APIs 封装
 * 6 个端点：create / reactivate / get_active_list / get_subscription_info / get_trade_order_info / get_subscription_tier_info
 *
 * Base URL: https://open.tiktokapis.com/v2/minis/
 */

import { PrismaClient } from '@prisma/client';
import { getValidAccessToken } from './tiktok-oauth';

const BASE_URL = 'https://open.tiktokapis.com/v2/minis';

// ===== 错误码处理（Subscription 特有） =====
interface TikTokError {
  code: string;
  message: string;
  log_id: string;
}

function handleError(error: TikTokError, context: string): never {
  const code = error.code;
  const logId = error.log_id;

  // System / Invalid Param
  if (code === '50001000') {
    throw new Error(`[${context}] TikTok Internal Error (50001000). log_id=${logId}. Retry later.`);
  }
  if (code === '40001000') {
    throw new Error(`[${context}] Invalid Parameters (40001000). log_id=${logId}. Check request params.`);
  }
  // Payment shared
  if (code === '20021001') {
    throw new Error(`[${context}] Submerchant ID invalid (20021001). log_id=${logId}. Contact TikTok to enable payment.`);
  }
  if (code === '20021002') {
    throw new Error(`[${context}] Outer order ID existed (20021002). log_id=${logId}. Use unique order_id.`);
  }
  if (code === '20001003') {
    throw new Error(`[${context}] Tier ID invalid (20001003). log_id=${logId}. Check tier_id.`);
  }
  // Subscription specific
  if (code === '20021101') {
    throw new Error(`[${context}] Subscription is active (20021101). log_id=${logId}. Cannot create new subscription.`);
  }
  if (code === '20021102') {
    throw new Error(`[${context}] Subscription is canceled (20021102). log_id=${logId}. Use reactivate instead.`);
  }
  if (code === '20021103') {
    throw new Error(`[${context}] Subscription is on hold (20021103). log_id=${logId}. Guide user to handle current subscription.`);
  }
  if (code === '20021108') {
    throw new Error(`[${context}] Change subscription unfinished (20021108). log_id=${logId}. Wait 1 hour between change requests.`);
  }
  if (code === '20021111') {
    throw new Error(`[${context}] Subscription too close to renewal (20021111). log_id=${logId}. Cannot change within 24h of renewal.`);
  }

  throw new Error(`[${context}] TikTok API error: ${code} - ${error.message}. log_id=${logId}`);
}

async function tiktokPost(path: string, accessToken: string, body?: any): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json() as any;
  if (data.error && data.error.code !== 'ok') {
    handleError(data.error, path);
  }
  return data;
}

// ===== Types =====

export interface SubscriptionOrderInfo {
  order_id: string;
  product_name: string;
  order_url?: string;
  order_detail?: string;
}

export interface SubscriptionObject {
  subscription_id: string;
  tier_id: string;
  is_subscription_rights_valid: boolean;
  is_renewal_normal: boolean;
  trade_order_id: string;
  begin_time?: number;
  end_time?: number;
  next_deduct_time?: number;
  is_sandbox?: boolean;
  pay_type?: 'IAP' | 'WEB' | 'ACA';
}

export interface SubscriptionTierInfo {
  tier_id: string;
  deduct_cycle: 'WEEKLY' | 'MONTHLY' | 'BIMONTHLY' | 'QUARTERLY' | 'SEMIANNUALLY' | 'ANNUALLY';
  deduct_type: 'one_time' | 'auto_renew';
  price: string;
  currency: string;
  symbol: string;
}

export interface SubscriptionTradeOrderInfo {
  trade_order_id: string;
  subscription_id: string;
  trade_order_status: 'SUCCESS' | 'PENDING' | 'REFUNDED';
  is_sandbox?: boolean;
  begin_time?: number;
  end_time?: number;
  next_deduct_time?: number;
  actually_end_time?: number;
  pay_type?: 'IAP' | 'WEB';
}

// ===== API Methods =====

/**
 * 创建订阅
 */
export async function createSubscription(
  tierId: string,
  orderInfo: SubscriptionOrderInfo,
  openId: string,
  prisma: PrismaClient
): Promise<{ trade_order_id: string }> {
  const accessToken = await getValidAccessToken(openId, prisma);
  const data = await tiktokPost('/subscription/create/', accessToken, {
    tier_id: tierId,
    order_info: orderInfo,
  });
  return data.data;
}

/**
 * 重新激活订阅
 */
export async function reactivateSubscription(
  subscriptionId: string,
  orderInfo: SubscriptionOrderInfo,
  openId: string,
  prisma: PrismaClient
): Promise<{ trade_order_id: string }> {
  const accessToken = await getValidAccessToken(openId, prisma);
  const data = await tiktokPost('/subscription/reactivate/', accessToken, {
    subscription_id: subscriptionId,
    order_info: orderInfo,
  });
  return data.data;
}

/**
 * 获取用户活跃订阅列表
 */
export async function getActiveSubscriptions(
  openId: string,
  prisma: PrismaClient
): Promise<SubscriptionObject[]> {
  const accessToken = await getValidAccessToken(openId, prisma);
  const data = await tiktokPost('/subscription/get_active_list/', accessToken);
  return data.data?.subscriptions || [];
}

/**
 * 按 trade_order_id 查询订阅详情
 */
export async function getSubscriptionInfo(
  tradeOrderId: string,
  openId: string,
  prisma: PrismaClient
): Promise<SubscriptionObject> {
  const accessToken = await getValidAccessToken(openId, prisma);
  const data = await tiktokPost('/subscription/get_subscription_info/', accessToken, {
    trade_order_id: tradeOrderId,
  });
  return data.data?.subscription;
}

/**
 * 按 trade_order_id 查询交易详情
 */
export async function getSubscriptionTradeOrderInfo(
  tradeOrderId: string,
  openId: string,
  prisma: PrismaClient
): Promise<SubscriptionTradeOrderInfo> {
  const accessToken = await getValidAccessToken(openId, prisma);
  const data = await tiktokPost('/subscription/get_trade_order_info/', accessToken, {
    trade_order_id: tradeOrderId,
  });
  return data.data;
}

/**
 * 获取订阅套餐信息
 */
export async function getSubscriptionTierInfo(
  tierIds: string[],
  openId: string,
  prisma: PrismaClient,
  devicePlatform?: 'android' | 'iphone'
): Promise<Record<string, SubscriptionTierInfo>> {
  const accessToken = await getValidAccessToken(openId, prisma);
  const body: any = { tier_ids: tierIds };
  if (devicePlatform) body.device_platform = devicePlatform;
  const data = await tiktokPost('/subscription/get_subscription_tier_info/', accessToken, body);
  return data.data?.subscription_tiers_info || {};
}
