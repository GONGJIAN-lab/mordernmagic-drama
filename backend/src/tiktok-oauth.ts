/**
 * TikTok Minis OAuth Token 管理
 * 封装 fetch / refresh / revoke 操作，带内存缓存
 *
 * 端点: POST https://open.tiktokapis.com/v2/oauth/token/
 * Header: Content-Type: application/x-www-form-urlencoded
 */

import { PrismaClient } from '@prisma/client';

const TIKTOK_OAUTH_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const TIKTOK_REVOKE_URL = 'https://open.tiktokapis.com/v2/oauth/revoke/';

interface TokenResponse {
  access_token: string;
  expires_in: number;
  open_id: string;
  refresh_expires_in: number;
  refresh_token: string;
  scope: string;
  token_type: string;
}

interface TokenCacheEntry {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;      // unix timestamp (ms)
  refreshExpiresAt: number; // unix timestamp (ms)
  openId: string;
  scope: string;
}

// 内存缓存（生产环境建议用 Redis）
const tokenCache = new Map<string, TokenCacheEntry>();

function getClientCreds(): { clientKey: string; clientSecret: string } {
  const clientKey = process.env.TIKTOK_CLIENT_KEY_DRAMAFLIX || process.env.TIKTOK_CLIENT_KEY || '';
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET_DRAMAFLIX || process.env.TIKTOK_CLIENT_SECRET || '';
  if (!clientKey || !clientSecret) {
    throw new Error('Missing TIKTOK_CLIENT_KEY or TIKTOK_CLIENT_SECRET env vars');
  }
  return { clientKey, clientSecret };
}

/**
 * 用 authorization_code 换取 access_token + refresh_token
 */
export async function fetchAccessToken(code: string): Promise<TokenResponse> {
  const { clientKey, clientSecret } = getClientCreds();

  const params = new URLSearchParams();
  params.append('client_key', clientKey);
  params.append('client_secret', clientSecret);
  params.append('code', code);
  params.append('grant_type', 'authorization_code');

  const res = await fetch(TIKTOK_OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const data = await res.json() as any;
  if (!res.ok || data.error) {
    throw new Error(`fetchAccessToken failed: ${data.error_description || data.error || res.statusText}`);
  }

  const result = data as TokenResponse;
  cacheToken(result.open_id, result);
  return result;
}

/**
 * 用 refresh_token 续期 access_token
 * ⚠️ 返回的 refresh_token 可能与传入的不同，必须用新的！
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const { clientKey, clientSecret } = getClientCreds();

  const params = new URLSearchParams();
  params.append('client_key', clientKey);
  params.append('client_secret', clientSecret);
  params.append('grant_type', 'refresh_token');
  params.append('refresh_token', refreshToken);

  const res = await fetch(TIKTOK_OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const data = await res.json() as any;
  if (!res.ok || data.error) {
    throw new Error(`refreshAccessToken failed: ${data.error_description || data.error || res.statusText}`);
  }

  const result = data as TokenResponse;
  cacheToken(result.open_id, result);
  return result;
}

/**
 * 吊销 token
 */
export async function revokeAccessToken(accessToken: string): Promise<void> {
  const { clientKey, clientSecret } = getClientCreds();

  const params = new URLSearchParams();
  params.append('client_key', clientKey);
  params.append('client_secret', clientSecret);
  params.append('token', accessToken);

  const res = await fetch(TIKTOK_REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as any;
    throw new Error(`revokeAccessToken failed: ${data.error_description || res.statusText}`);
  }
}

/**
 * 缓存 token 到内存
 */
function cacheToken(openId: string, resp: TokenResponse): void {
  const now = Date.now();
  tokenCache.set(openId, {
    accessToken: resp.access_token,
    refreshToken: resp.refresh_token,
    expiresAt: now + resp.expires_in * 1000,
    refreshExpiresAt: now + resp.refresh_expires_in * 1000,
    openId: resp.open_id,
    scope: resp.scope,
  });
}

/**
 * 获取有效的 access_token（自动续期）
 * 优先用内存缓存，失败回退到数据库
 */
export async function getValidAccessToken(
  openId: string,
  prisma: PrismaClient
): Promise<string> {
  const cached = tokenCache.get(openId);
  const now = Date.now();

  // 缓存有效，直接返回
  if (cached && cached.expiresAt > now + 60_000) {
    return cached.accessToken;
  }

  // 缓存过期或不存在，尝试从数据库读 refresh_token
  const user = await prisma.user.findUnique({
    where: { openId },
    select: { tiktokRefreshToken: true },
  });

  if (!user?.tiktokRefreshToken) {
    throw new Error(`No refresh token for openId=${openId}. User needs to login first.`);
  }

  // refresh token 也过期了
  if (cached && cached.refreshExpiresAt < now) {
    throw new Error(`Refresh token expired for openId=${openId}. User needs to re-login.`);
  }

  // 续期
  const refreshed = await refreshAccessToken(user.tiktokRefreshToken);

  // 更新数据库（refresh_token 可能变了）
  await prisma.user.update({
    where: { openId },
    data: {
      tiktokAccessToken: refreshed.access_token,
      tiktokRefreshToken: refreshed.refresh_token,
      tiktokTokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
    },
  });

  return refreshed.access_token;
}

/**
 * 用 auth_code 完成用户首次登录，写入数据库
 */
export async function loginWithAuthCode(
  code: string,
  prisma: PrismaClient
): Promise<{ openId: string; accessToken: string }> {
  const resp = await fetchAccessToken(code);

  await prisma.user.upsert({
    where: { openId: resp.open_id },
    update: {
      tiktokAccessToken: resp.access_token,
      tiktokRefreshToken: resp.refresh_token,
      tiktokTokenExpiresAt: new Date(Date.now() + resp.expires_in * 1000),
    },
    create: {
      openId: resp.open_id,
      tiktokAccessToken: resp.access_token,
      tiktokRefreshToken: resp.refresh_token,
      tiktokTokenExpiresAt: new Date(Date.now() + resp.expires_in * 1000),
    },
  });

  return { openId: resp.open_id, accessToken: resp.access_token };
}

/**
 * 构造 TikTok OAuth 授权链接（给前端用）
 */
export function buildAuthUrl(state: string = 'default'): string {
  const clientKey = process.env.TIKTOK_CLIENT_KEY || '';
  const redirectUri = process.env.TIKTOK_REDIRECT_URI || '';
  if (!clientKey) throw new Error('Missing TIKTOK_CLIENT_KEY');

  const url = new URL('https://www.tiktok.com/auth/authorize/');
  url.searchParams.set('client_key', clientKey);
  url.searchParams.set('redirect_uri', redirectUri || 'https://drama.mordernmagic.com/auth/callback');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'user.info.basic');
  url.searchParams.set('state', state);
  return url.toString();
}
