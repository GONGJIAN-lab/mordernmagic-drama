import express, { Request, Response, NextFunction } from 'express';
declare global {
  namespace Express {
    interface Response {
      data: (payload: any) => Response;
    }
  }
}
export {};
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Resend } from 'resend';
import { PrismaClient } from '@prisma/client';
import { createTikTokWebhookRouter } from './webhook/tiktok';
import { createPrismaAdapter } from './webhook/prisma-adapter';
import * as TikTokOAuth from './tiktok-oauth';
import * as TikTokSubscription from './tiktok-subscription';

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const resend = new Resend(process.env.RESEND_API_KEY || '');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://drama.mordernmagic.com';
const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY || '';
const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET || '';

/**
 * App-level access token cache (Client Credentials flow)
 * Used for TikTok Open API server-to-server calls (e.g. play_token)
 */
let appAccessTokenCache: { token: string; expiresAt: number } | null = null;

async function getAppAccessToken(): Promise<string> {
  if (appAccessTokenCache && appAccessTokenCache.expiresAt > Date.now() + 60_000) {
    return appAccessTokenCache.token;
  }
  if (!TIKTOK_CLIENT_KEY || !TIKTOK_CLIENT_SECRET) {
    throw new Error('Missing TIKTOK_CLIENT_KEY or TIKTOK_CLIENT_SECRET env vars');
  }

  const params = new URLSearchParams();
  params.append('client_key', TIKTOK_CLIENT_KEY);
  params.append('client_secret', TIKTOK_CLIENT_SECRET);
  params.append('grant_type', 'client_credentials');

  const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const data = await res.json().catch(() => ({})) as any;
  if (!res.ok || data.error) {
    throw new Error(`getAppAccessToken failed: ${data.error_description || data.error || res.statusText}`);
  }

  appAccessTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 7200) * 1000,
  };
  return data.access_token;
}

/**
 * Get play_auth_token from TikTok Open API for VePlayer playback.
 * Endpoint: GET /v2/sg/shortdrama/play_token/?client_key=...&episode_id=...
 * Requires app-level access_token.
 */
async function getPlayAuthToken(episodeId: string): Promise<string> {
  const accessToken = await getAppAccessToken();

  const url = new URL('https://open.tiktokapis.com/v2/sg/shortdrama/play_token/');
  url.searchParams.set('client_key', TIKTOK_CLIENT_KEY);
  url.searchParams.set('episode_id', episodeId);

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });

  const data = await res.json().catch(() => ({})) as any;
  if (!res.ok || data.error) {
    throw new Error(`getPlayAuthToken failed: ${data.error_description || data.error || res.statusText}`);
  }

  // TikTok API may wrap response in data.data or return directly
  const token = data.data?.play_auth_token || data.play_auth_token || '';
  if (!token) {
    throw new Error('getPlayAuthToken: play_auth_token missing in response');
  }
  return token;
}

// ===== BytePlus VOD API Client =====
const BYTEPLUS_AK = process.env.BYTEPLUS_ACCESS_KEY_ID || '';
const BYTEPLUS_SK = process.env.BYTEPLUS_SECRET_ACCESS_KEY || '';
const BYTEPLUS_HOST = 'open.byteplusapi.com';
const BYTEPLUS_REGION = 'ap-singapore-1';
const BYTEPLUS_SERVICE = 'vod';

function byteplusSha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function byteplusHmac(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function byteplusSignRequest(method: string, path: string, queryParams: Record<string, string>, body: string = '') {
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const timeStamp = now.toISOString().slice(0, 19).replace(/[-:]/g, '') + 'Z';
  const bodyHash = byteplusSha256(body);

  const sortedParams = Object.keys(queryParams).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
    .join('&');

  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    'host': BYTEPLUS_HOST,
    'x-content-sha256': bodyHash,
    'x-date': timeStamp,
  };

  const signedHeaders = Object.keys(headers).sort().join(';');
  const headerLines = Object.keys(headers).sort()
    .map(k => `${k.toLowerCase()}:${headers[k]}`).join('\n') + '\n';

  const canonicalRequest = [
    method, path, sortedParams, headerLines, signedHeaders, bodyHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${BYTEPLUS_REGION}/${BYTEPLUS_SERVICE}/request`;
  const stringToSign = [
    'HMAC-SHA256', timeStamp, credentialScope, byteplusSha256(canonicalRequest),
  ].join('\n');

  const kDate = byteplusHmac(BYTEPLUS_SK, dateStamp);
  const kRegion = byteplusHmac(kDate, BYTEPLUS_REGION);
  const kService = byteplusHmac(kRegion, BYTEPLUS_SERVICE);
  const kSigning = byteplusHmac(kService, 'request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const auth = `HMAC-SHA256 Credential=${BYTEPLUS_AK}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { headers: { ...headers, Authorization: auth }, sortedParams };
}

async function byteplusGetAllMedia(spaceName: string): Promise<any[]> {
  const allMedia: any[] = [];
  let offset = 0;
  const pageSize = 50;

  while (true) {
    const params: Record<string, string> = {
      Action: 'GetMediaList',
      Version: '2023-01-01',
      SpaceName: spaceName,
      PageSize: String(pageSize),
      Offset: String(offset),
    };

    const signed = byteplusSignRequest('GET', '/', params);
    const url = `https://${BYTEPLUS_HOST}/?${signed.sortedParams}`;

    const res = await fetch(url, { headers: signed.headers });
    const data = await res.json() as any;

    if (!data.Result || !data.Result.MediaInfoList) break;

    const list = data.Result.MediaInfoList;
    allMedia.push(...list);
    if (list.length < pageSize) break;
    offset += pageSize;
  }

  return allMedia;
}

// ===== Subscription Tier Config =====
const SUBSCRIPTION_TIERS = [
  {
    tierId: process.env.BIGSTAR_TIER_MONTHLY || 'bigstar_600_600_1_1m_set1',
    name: 'Monthly',
    price: '$6.00',
    period: 'month',
    label: '月卡',
  },
  {
    tierId: process.env.BIGSTAR_TIER_QUARTERLY || 'bigstar_1499_600_1_3m_set1',
    name: 'Quarterly',
    price: '$14.99',
    period: 'quarter',
    label: '季卡',
  },
  {
    tierId: process.env.BIGSTAR_TIER_HALF_YEARLY || 'bigstar_2999_600_1_6m_set1',
    name: 'Half-Yearly',
    price: '$29.99',
    period: 'half-year',
    label: '半年卡',
  },
];

// ===== Types =====
interface AuthenticatedRequest extends Request {
  userId?: string;
}

// ===== Middleware =====
function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: missing or invalid token' });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    req.userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized: invalid token' });
  }
}

function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction): void {
  console.error('Error:', err);
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';
  res.status(status).json({ error: message });
}

// ===== CORS =====
app.use(cors({ origin: '*' }));
app.get('/', (_req, res) => res.json({ status: 'ok', version: '2.5.0' }));
app.use((req, res, next) => {
  res.data = (payload) => res.json({ data: payload });
  next();
});

// ===== TikTok Minis Webhook (MUST be before express.json()) =====
app.use('/webhook/tiktok', express.raw({ type: 'application/json' }));
const tiktokDbAdapter = createPrismaAdapter({ prisma });
app.use(
  '/webhook',
  createTikTokWebhookRouter({
    signature: {
      secret: process.env.TIKTOK_WEBHOOK_SECRET || '',
      clientKey: process.env.TIKTOK_CLIENT_KEY || '',
      headerName: 'tiktok-signature',
      algorithm: 'tiktok-minis',
      checkTimestamp: true,
      timestampTolerance: 300,
    },
    db: tiktokDbAdapter,
    verbose: process.env.NODE_ENV !== 'production',
    customHandlers: {
      // Subscription webhook events — trade_order 已彻底移除
      'minis.subscription_order.redeem.success': async (payload: any) => {
        try {
          // 兼容两种 payload 格式：顶层字段 或 payload.subscription 嵌套
          const sub = payload.subscription || payload;
          const subscriptionId = sub.subscription_id || payload.subscription_id || '';
          const openId = sub.open_id || payload.user_id || '';
          const skuId = sub.sku_id || sub.tier_id || payload.tier_id || '';
          const orderId = payload.order_id || sub.order_id || '';

          if (!subscriptionId || !openId) {
            console.error('[Webhook] subscription_order.redeem.success: missing subscription_id or user_id/open_id', payload);
            return;
          }

          // 根据 tier 计算过期时间（默认 30 天）
          const tierDurationDays = skuId.includes('3m') ? 90 : skuId.includes('6m') ? 180 : 30;
          const now = new Date();
          const expireTime = sub.expire_time || sub.end_time
            ? new Date((sub.expire_time || sub.end_time) * 1000)
            : new Date(now.getTime() + tierDurationDays * 24 * 60 * 60 * 1000);

          await prisma.minisSubscription.upsert({
            where: { subscriptionId },
            create: {
              subscriptionId,
              openId,
              skuId,
              orderId: orderId || null,
              status: 'active',
              startTime: sub.start_time || sub.begin_time ? new Date((sub.start_time || sub.begin_time) * 1000) : now,
              expireTime,
              autoRenew: sub.auto_renew !== false && payload.auto_renew !== false,
              nextRenewTime: sub.next_renew_time || sub.next_deduct_time ? new Date((sub.next_renew_time || sub.next_deduct_time) * 1000) : null,
            },
            update: {
              openId,
              skuId,
              orderId: orderId || undefined,
              status: 'active',
              startTime: sub.start_time || sub.begin_time ? new Date((sub.start_time || sub.begin_time) * 1000) : undefined,
              expireTime,
              autoRenew: sub.auto_renew !== false && payload.auto_renew !== false,
              nextRenewTime: sub.next_renew_time || sub.next_deduct_time ? new Date((sub.next_renew_time || sub.next_deduct_time) * 1000) : undefined,
            },
          });
          console.log(`[Webhook] Subscription activated: ${subscriptionId}, tier=${skuId}, order=${orderId}`);
        } catch (err) {
          console.error('[Webhook] subscription_order.redeem.success error:', err);
          throw err;
        }
      },
      'minis.subscription_order.expired': async (payload: any) => {
        try {
          const sub = payload.subscription || payload;
          const subscriptionId = sub.subscription_id || payload.subscription_id || '';
          if (!subscriptionId) {
            console.error('[Webhook] subscription_order.expired: missing subscription_id', payload);
            return;
          }
          await prisma.minisSubscription.updateMany({
            where: { subscriptionId },
            data: { status: 'expired', autoRenew: false },
          });
          console.log(`[Webhook] Subscription expired: ${subscriptionId}`);
        } catch (err) {
          console.error('[Webhook] subscription_order.expired error:', err);
          throw err;
        }
      },
      'minis.subscription_order.auto_renew_disabled': async (payload: any) => {
        try {
          const sub = payload.subscription || payload;
          const subscriptionId = sub.subscription_id || payload.subscription_id || '';
          if (!subscriptionId) {
            console.error('[Webhook] subscription_order.auto_renew_disabled: missing subscription_id', payload);
            return;
          }
          await prisma.minisSubscription.updateMany({
            where: { subscriptionId },
            data: { autoRenew: false },
          });
          console.log(`[Webhook] Auto-renew disabled: ${subscriptionId}`);
        } catch (err) {
          console.error('[Webhook] subscription_order.auto_renew_disabled error:', err);
          throw err;
        }
      },
    },
  })
);

// ===== JSON body parser for all other routes =====
app.use(express.json());

// ===== Health Check =====
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), version: '3.0.0' });
});

// ============================================================
// AUTH: TikTok Minis OAuth
// ============================================================

app.post('/api/minis/auth/login', async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'auth_code required' });
      return;
    }

    const result = await TikTokOAuth.loginWithAuthCode(code, prisma);
    const token = jwt.sign({ userId: result.openId, openId: result.openId }, JWT_SECRET, { expiresIn: '7d' });

    res.data({ token, openId: result.openId });
  } catch (err) {
    next(err);
  }
});

app.get('/api/minis/auth/url', (_req, res, next) => {
  try {
    const url = TikTokOAuth.buildAuthUrl('bigstar_drama');
    res.data({ authUrl: url });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// AUTH: Email OTP (backup login)
// ============================================================

app.post('/api/auth/send-otp', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      res.status(400).json({ error: 'Invalid email' });
      return;
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.user.upsert({
      where: { email },
      update: { otpCode: code, otpExpiresAt: expiresAt },
      create: { email, otpCode: code, otpExpiresAt: expiresAt },
    });

    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'noreply@mordernmagic.com',
      to: email,
      subject: 'BIG STAR Drama 验证码',
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        <h2 style="color:#1a365d;">BIG STAR Drama</h2>
        <p>您的登录验证码是 <strong style="font-size:24px;color:#1a365d;">${code}</strong>，10 分钟内有效。</p>
        <p style="color:#666;font-size:12px;">如非本人操作，请忽略此邮件。</p>
      </div>`,
    });

    res.data({ success: true, message: 'OTP sent' });
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/verify-otp', async (req, res, next) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      res.status(400).json({ error: 'Email and code required' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.otpCode !== code || !user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      res.status(400).json({ error: 'Invalid or expired OTP' });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { otpCode: null, otpExpiresAt: null },
    });

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.data({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// DRAMAS
// ============================================================

app.get('/api/dramas', async (_req, res, next) => {
  try {
    const dramas = await prisma.drama.findMany({
      select: { slug: true, title: true, cover: true, totalEpisodes: true, priceCents: true },
      orderBy: { createdAt: 'desc' },
    });
    res.data(dramas);
  } catch (err) {
    next(err);
  }
});

app.get('/api/dramas/:slug', async (req, res, next) => {
  try {
    const drama = await prisma.drama.findUnique({
      where: { slug: req.params.slug },
      include: {
        episodes: {
          select: { id: true, episodeNumber: true, s3Key: true, durationSec: true, byteplusVid: true },
          orderBy: { episodeNumber: 'asc' },
        },
      },
    });
    if (!drama) {
      res.status(404).json({ error: 'Drama not found' });
      return;
    }
    res.data(drama);
  } catch (err) {
    next(err);
  }
});

app.get('/api/dramas/:slug/episodes', async (req, res, next) => {
  try {
    const drama = await prisma.drama.findUnique({
      where: { slug: req.params.slug },
      select: { id: true },
    });
    if (!drama) {
      res.status(404).json({ error: 'Drama not found' });
      return;
    }
    const episodes = await prisma.episode.findMany({
      where: { dramaId: drama.id },
      select: { id: true, episodeNumber: true, s3Key: true, durationSec: true, byteplusVid: true },
      orderBy: { episodeNumber: 'asc' },
    });
    res.data(episodes);
  } catch (err) {
    next(err);
  }
});

// ============================================================
// SUBSCRIPTION: TikTok Minis Subscription APIs
// ============================================================

/**
 * GET /api/minis/subscription/tiers
 * 返回 3 档订阅配置（前端展示用，无需鉴权）
 */
app.get('/api/minis/subscription/tiers', (_req, res) => {
  res.data({ tiers: SUBSCRIPTION_TIERS });
});

/**
 * POST /api/minis/subscription/create
 * 创建订阅订单
 */
app.post('/api/minis/subscription/create', async (req, res, next) => {
  try {
    const { tierId, orderInfo, openId } = req.body;
    if (!tierId || !orderInfo || !openId) {
      res.status(400).json({ error: 'tierId, orderInfo, openId required' });
      return;
    }

    const result = await TikTokSubscription.createSubscription(tierId, orderInfo, openId, prisma);
    res.data(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/minis/subscription/get-active-list
 * 获取用户活跃订阅列表
 */
app.post('/api/minis/subscription/get-active-list', async (req, res, next) => {
  try {
    const { openId } = req.body;
    if (!openId) {
      res.status(400).json({ error: 'openId required' });
      return;
    }

    const result = await TikTokSubscription.getActiveSubscriptions(openId, prisma);
    res.data({ subscriptions: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/minis/subscription/get-tier-info
 * 获取订阅套餐信息（带平台价格）
 */
app.post('/api/minis/subscription/get-tier-info', async (req, res, next) => {
  try {
    const { tierIds, openId, devicePlatform } = req.body;
    if (!tierIds || !Array.isArray(tierIds) || !openId) {
      res.status(400).json({ error: 'tierIds (array), openId required' });
      return;
    }

    const result = await TikTokSubscription.getSubscriptionTierInfo(tierIds, openId, prisma, devicePlatform);
    res.data(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/minis/subscription/get-subscription-info
 * 按 trade_order_id 查订阅详情
 */
app.post('/api/minis/subscription/get-subscription-info', async (req, res, next) => {
  try {
    const { tradeOrderId, openId } = req.body;
    if (!tradeOrderId || !openId) {
      res.status(400).json({ error: 'tradeOrderId, openId required' });
      return;
    }

    const result = await TikTokSubscription.getSubscriptionInfo(tradeOrderId, openId, prisma);
    res.data(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/minis/subscription/reactivate
 * 重新激活订阅
 */
app.post('/api/minis/subscription/reactivate', async (req, res, next) => {
  try {
    const { subscriptionId, orderInfo, openId } = req.body;
    if (!subscriptionId || !orderInfo || !openId) {
      res.status(400).json({ error: 'subscriptionId, orderInfo, openId required' });
      return;
    }

    const result = await TikTokSubscription.reactivateSubscription(subscriptionId, orderInfo, openId, prisma);
    res.data(result);
  } catch (err) {
    next(err);
  }
});

// ============================================================
// SUBSCRIPTION CHECK: 检查用户是否有有效订阅
// ============================================================

async function hasActiveSubscription(openId: string): Promise<boolean> {
  if (!openId) return false;
  const sub = await prisma.minisSubscription.findFirst({
    where: {
      openId,
      status: 'active',
      OR: [
        { expireTime: null },
        { expireTime: { gt: new Date() } },
      ],
    },
  });
  return !!sub;
}

/**
 * GET /api/minis/subscription/status?openId=xxx
 * 快速检查用户订阅状态（前端用）
 */
app.get('/api/minis/subscription/status', async (req, res, next) => {
  try {
    const { openId } = req.query;
    if (!openId) {
      res.status(400).json({ error: 'openId required' });
      return;
    }
    const active = await hasActiveSubscription(String(openId));
    res.data({ subscribed: active });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// UNLOCK STATUS (legacy compat, now subscription-based)
// ============================================================

app.get('/api/minis/unlock-status', async (req, res, next) => {
  try {
    const { openId, dramaSlug, episodeNumber } = req.query;
    if (!openId || !dramaSlug) {
      res.status(400).json({ error: 'openId, dramaSlug required' });
      return;
    }

    // 前 3 集永远免费
    if (episodeNumber && Number(episodeNumber) <= 3) {
      res.data({ unlocked: true, type: 'free_preview' });
      return;
    }

    // 检查是否有有效订阅
    const active = await hasActiveSubscription(String(openId));
    if (active) {
      res.data({ unlocked: true, type: 'subscription' });
      return;
    }

    res.data({ unlocked: false });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// Watch History
// ============================================================

app.get('/api/watch-history', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const history = await prisma.watchHistory.findMany({
      where: { userId: req.userId },
      include: {
        drama: { select: { slug: true, title: true, cover: true } },
        episode: { select: { episodeNumber: true, durationSec: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    res.data(history);
  } catch (err) {
    next(err);
  }
});

app.post('/api/watch-history', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { dramaSlug, episodeId, positionSec } = req.body;
    if (!dramaSlug || !episodeId || positionSec === undefined) {
      res.status(400).json({ error: 'dramaSlug, episodeId, positionSec required' });
      return;
    }

    const drama = await prisma.drama.findUnique({ where: { slug: dramaSlug } });
    if (!drama) {
      res.status(404).json({ error: 'Drama not found' });
      return;
    }

    const record = await prisma.watchHistory.upsert({
      where: { userId_dramaId_episodeId: { userId: req.userId!, dramaId: drama.id, episodeId } },
      update: { positionSec: Number(positionSec) },
      create: {
        userId: req.userId!,
        dramaId: drama.id,
        episodeId,
        positionSec: Number(positionSec),
      },
    });

    res.data(record);
  } catch (err) {
    next(err);
  }
});

// ============================================================
// Play Auth (TikTok Minis VePlayer) — subscription-gated
// Returns albumId, episodeId, vid, playAuthToken for VePlayer
// via TTMinis.getPlayer() constructor
// ============================================================

app.post('/api/dramas/:slug/episodes/:episodeNumber/play-auth', async (req, res, next) => {
  try {
    const { slug, episodeNumber } = req.params;
    const { openId } = req.body;
    const epNum = Number(episodeNumber);

    const drama = await prisma.drama.findUnique({
      where: { slug },
      select: { id: true, albumId: true, slug: true },
    });
    if (!drama) return res.status(404).json({ error: 'drama not found' });

    const ep = await prisma.episode.findFirst({
      where: { dramaId: drama.id, episodeNumber: epNum },
    });
    if (!ep) return res.status(404).json({ error: 'episode not found' });

    // 前 3 集免费，无需订阅
    if (epNum <= 3) {
      // Fallback: if byteplusEpisodeId not set yet, use episode.id as temporary fallback
      // (will be replaced with real TikTok episode_id after content review)
      const episodeId = ep.byteplusEpisodeId || ep.id;
      let playAuthToken = '';
      try {
        playAuthToken = await getPlayAuthToken(episodeId);
      } catch (tokenErr) {
        console.warn(`[play-auth] getPlayAuthToken fallback warning (free ep ${epNum}):`, tokenErr);
        // If token fetch fails (e.g. episode not reviewed yet), return empty token
        // VePlayer will still attempt playback with vid + albumId + episodeId
      }

      res.data({
        episodeId: ep.id,
        episodeNumber: ep.episodeNumber,
        durationSec: ep.durationSec,
        albumId: drama.albumId || drama.slug,
        byteplusEpisodeId: ep.byteplusEpisodeId || ep.id,
        vid: ep.byteplusVid || '',
        playAuthToken,
        unlocked: true,
        type: 'free_preview',
      });
      return;
    }

    // 检查订阅状态
    const active = openId ? await hasActiveSubscription(openId) : false;
    if (!active) {
      res.status(402).json({
        error: 'Subscription required',
        needSubscription: true,
        tiers: SUBSCRIPTION_TIERS,
      });
      return;
    }

    const episodeId = ep.byteplusEpisodeId || ep.id;
    let playAuthToken = '';
    try {
      playAuthToken = await getPlayAuthToken(episodeId);
    } catch (tokenErr) {
      console.warn(`[play-auth] getPlayAuthToken fallback warning (sub ep ${epNum}):`, tokenErr);
    }

    res.data({
      episodeId: ep.id,
      episodeNumber: ep.episodeNumber,
      durationSec: ep.durationSec,
      albumId: drama.albumId || drama.slug,
      byteplusEpisodeId: ep.byteplusEpisodeId || ep.id,
      vid: ep.byteplusVid || '',
      playAuthToken,
      unlocked: true,
      type: 'subscription',
    });
  } catch (e: any) {
    next(e);
  }
});

// ============================================================
// Admin: Sync BytePlus VIDs to database
// ============================================================

app.post('/api/admin/sync-byteplus-vids', async (req, res, next) => {
  try {
    const media = await byteplusGetAllMedia('bigstar-drama');
    const episodeMap = new Map<number, string>();

    for (const m of media) {
      const title = m.BasicInfo?.Title || '';
      const match = title.match(/穿进虐文(\d+)\.mp4/);
      if (match) {
        const epNum = parseInt(match[1], 10);
        const vid = m.BasicInfo?.Vid;
        if (epNum >= 1 && epNum <= 45 && vid) {
          episodeMap.set(epNum, vid);
        }
      }
    }

    const dramas = await prisma.drama.findMany({ select: { id: true, slug: true } });
    if (dramas.length === 0) {
      res.status(404).json({ error: 'No dramas found' });
      return;
    }

    let updated = 0;
    for (const drama of dramas) {
      const episodes = await prisma.episode.findMany({
        where: { dramaId: drama.id },
        select: { id: true, episodeNumber: true },
      });

      for (const ep of episodes) {
        const vid = episodeMap.get(ep.episodeNumber);
        if (vid) {
          await prisma.episode.update({
            where: { id: ep.id },
            data: { byteplusVid: vid },
          });
          updated++;
        }
      }
    }

    res.data({ updated, totalEpisodes: episodeMap.size, dramas: dramas.length });
  } catch (e: any) {
    next(e);
  }
});

// ===== Error handler (must be last) =====
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`BIG STAR Drama backend v2.5.0 running on port ${PORT}`);
});
