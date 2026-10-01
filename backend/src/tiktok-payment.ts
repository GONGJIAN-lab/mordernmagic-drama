/**
 * TikTok Minis Payment APIs 封装
 * 4 个端点：get_tier_infos / trade_order/create / trade_order/query / check_redeem_amounts
 *
 * Base URL: https://open.tiktokapis.com/v2/minis/
 */

import { PrismaClient } from '@prisma/client';
import { getValidAccessToken } from './tiktok-oauth';

const BASE_URL = 'https://open.tiktokapis.com/v2/minis';

// ===== 错误码处理 =====
interface TikTokError {
  code: string;
  message: string;
  log_id: string;
}

function handleError(error: TikTokError, context: string): never {
  const code = error.code;
  const logId = error.log_id;

  // System Error
  if (code === '50001000') {
    throw new Error(`[${context}] TikTok Internal Error (50001000). log_id=${logId}. Retry later.`);
  }
  // Invalid Param
  if (code === '40001000') {
    throw new Error(`[${context}] Invalid Parameters (40001000). log_id=${logId}. Check request params.`);
  }
  // Business Errors
  if (code === '20011002') {
    throw new Error(`[${context}] Order not existed (20011002). log_id=${logId}. Verify trade_order_id.`);
  }
  if (code === '20021001') {
    throw new Error(`[${context}] Submerchant ID invalid (20021001). log_id=${logId}. Contact TikTok to enable payment.`);
  }
  if (code === '20021002') {
    throw new Error(`[${context}] Outer order ID existed (20021002). log_id=${logId}. Use unique order_id.`);
  }
  if (code === '20001003') {
    throw new Error(`[${context}] Tier ID invalid (20001003). log_id=${logId}. Check tier_id.`);
  }

  throw new Error(`[${context}] TikTok API error: ${code} - ${error.message}. log_id=${logId}`);
}

async function tiktokPost(path: string, accessToken: string, body: any): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json() as any;
  if (data.error && data.error.code !== 'ok') {
    handleError(data.error, path);
  }
  return data;
}

// ===== Tier Info =====

export interface TierInfo {
  tier_id: string;
  tier_name: string;
  token_type: string;
  token_amount: number;
  price: string;
  currency: string;
  symbol: string;
}

/**
 * 获取充值套餐信息
 */
export async function getTierInfos(
  tierIds: string[],
  openId: string,
  prisma: PrismaClient
): Promise<Record<string, TierInfo>> {
  const accessToken = await getValidAccessToken(openId, prisma);
  const data = await tiktokPost('/utility/get_tier_infos/', accessToken, {
    token_type: 'BEANS',
    tier_ids: tierIds,
  });
  return data.data?.tier_infos || {};
}

// ===== Order =====

export interface OrderInfo {
  order_id: string;
  order_url?: string;
  product_name: string;
  product_id: string;
  quantity: number;
  quantity_unit: string;
  image_url: string;
}

export interface CreateOrderResult {
  trade_order_id: string;
}

/**
 * 创建支付订单（真正调官方 API）
 */
export async function createTradeOrder(
  tokenAmount: number,
  orderInfo: OrderInfo,
  openId: string,
  prisma: PrismaClient
): Promise<CreateOrderResult> {
  const accessToken = await getValidAccessToken(openId, prisma);
  const data = await tiktokPost('/trade_order/create/', accessToken, {
    token_type: 'BEANS',
    token_amount: tokenAmount,
    order_info: orderInfo,
  });
  return data.data;
}

export interface TradeOrderInfo {
  trade_order_id: string;
  trade_order_status: 'PENDING' | 'SUCCESS' | 'REFUNDED';
}

/**
 * 查询订单状态
 */
export async function queryTradeOrder(
  tradeOrderId: string,
  openId: string,
  prisma: PrismaClient
): Promise<TradeOrderInfo> {
  const accessToken = await getValidAccessToken(openId, prisma);
  const data = await tiktokPost('/trade_order/query/', accessToken, {
    trade_order_id: tradeOrderId,
  });
  return data.data;
}

// ===== Check Redeem =====

export interface CheckRedeemResult {
  valid: boolean;
}

/**
 * 验证 Beans 金额合法性
 */
export async function checkRedeemAmounts(
  tokenAmounts: number[],
  openId: string,
  prisma: PrismaClient
): Promise<CheckRedeemResult> {
  const accessToken = await getValidAccessToken(openId, prisma);
  const data = await tiktokPost('/utility/check_redeem_amounts/', accessToken, {
    token_type: 'BEANS',
    token_amounts: tokenAmounts,
  });
  return data.data;
}
