/**
 * TikTok Minis Webhook 签名验证
 * 正确算法: HMAC-SHA256(secret, timestamp + "." + rawBody)
 */

import crypto from 'crypto';
import { SignatureConfig } from './types';

export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

/**
 * 验证 webhook 签名
 */
export function verifyWebhookSignature(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
  config: SignatureConfig
): void {
  const headerValue = headers[config.headerName.toLowerCase()];
  if (!headerValue) {
    throw new WebhookSignatureError(`Missing signature header: ${config.headerName}`);
  }

  const signatureStr = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const match = String(signatureStr).match(/t=(\d+),s=([a-f0-9]+)/i);
  if (!match) {
    throw new WebhookSignatureError(`Invalid ${config.headerName} format`);
  }

  const timestamp = match[1];
  const signature = match[2];

  // 时间戳防重放
  if (config.checkTimestamp !== false) {
    const ts = parseInt(timestamp, 10);
    const now = Math.floor(Date.now() / 1000);
    const tolerance = config.timestampTolerance || 300;
    if (Math.abs(now - ts) > tolerance) {
      throw new WebhookSignatureError(`Timestamp out of tolerance: ${ts} vs ${now}`);
    }
  }

  const bodyStr = rawBody.toString('utf8');
  let expected: string;

  if (config.algorithm === 'tiktok-minis') {
    expected = crypto
      .createHmac('sha256', config.secret)
      .update(timestamp + '.' + bodyStr)
      .digest('hex');
  } else {
    expected = crypto
      .createHmac('sha256', config.secret)
      .update(bodyStr)
      .digest('hex');
  }

  if (!crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'))) {
    throw new WebhookSignatureError('Signature mismatch');
  }
}

/**
 * 调试模式：尝试所有已知算法变体
 */
export function tryAllSignatureAlgorithms(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
  _clientKey: string,
  headerName: string
): Array<{ algorithm: string; matched: boolean }> {
  const headerValue = headers[headerName.toLowerCase()];
  if (!headerValue) return [];

  const signatureStr = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const match = String(signatureStr).match(/t=(\d+),s=([a-f0-9]+)/i);
  if (!match) return [];

  const timestamp = match[1];
  const signature = match[2];
  const bodyStr = rawBody.toString('utf8');

  const algorithms = [
    { name: 'hmac-sha256(body)', fn: () => crypto.createHmac('sha256', secret).update(bodyStr).digest('hex') },
    { name: 'hmac-sha256(timestamp+body)', fn: () => crypto.createHmac('sha256', secret).update(timestamp + bodyStr).digest('hex') },
    { name: 'hmac-sha256(timestamp+"."+body)', fn: () => crypto.createHmac('sha256', secret).update(timestamp + '.' + bodyStr).digest('hex') },
    { name: 'hmac-sha256(timestamp+":"+body)', fn: () => crypto.createHmac('sha256', secret).update(timestamp + ':' + bodyStr).digest('hex') },
    { name: 'sha256(secret+body)', fn: () => crypto.createHash('sha256').update(secret + bodyStr).digest('hex') },
  ];

  return algorithms.map(a => {
    const expected = a.fn();
    let matched = false;
    try {
      matched = crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
    } catch { /* length mismatch */ }
    return { algorithm: a.name, matched };
  });
}
