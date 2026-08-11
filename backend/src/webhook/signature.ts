/**
 * TikTok Minis Webhook 签名验证模块
 *
 * ⚠️ 重要说明：
 * TikTok Minis 的 webhook 签名官方文档未公开检索到。
 * 以下实现基于 TikTok Shop 官方签名方式推断（HMAC-SHA256 + 小写 hex），
 * 并支持 3 种常见算法。如果默认配置验签失败，请用 signature-debug.ts 工具
 * 或按 README 调整 algorithm 配置。
 */

import crypto from 'crypto';
import type { SignatureConfig } from './types';

/**
 * 验证 Webhook 请求签名
 * @param rawBody  原始请求 body（Buffer，未解析的原始字节）
 * @param headers  请求头对象
 * @param config   签名配置
 * @returns        验证通过返回 true，否则抛出错误
 */
export function verifyWebhookSignature(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
  config: SignatureConfig
): true {
  const {
    secret,
    clientKey,
    headerName = 'authorization',
    algorithm = 'tiktok-shop',
    checkTimestamp = true,
    timestampTolerance = 300,
  } = config;

  // 1. 取签名 header（大小写不敏感）
  const signatureHeader = getHeaderCaseInsensitive(headers, headerName);
  if (!signatureHeader) {
    throw new WebhookSignatureError(`Missing signature header: ${headerName}`);
  }

  // 2. 时间戳防重放检查（如果 header 中有 timestamp）
  // tiktok-minis 格式的时间戳在 signature header 中（t=...），单独处理
  let tiktokMinisTimestamp: string | undefined;
  if (checkTimestamp && algorithm !== 'tiktok-minis') {
    const timestampHeader = getHeaderCaseInsensitive(headers, 'x-tiktok-timestamp') || getHeaderCaseInsensitive(headers, 'timestamp');
    if (timestampHeader) {
      const ts = parseInt(String(timestampHeader), 10);
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - ts) > timestampTolerance) {
        throw new WebhookSignatureError(`Timestamp out of tolerance: ${ts} vs ${now}`);
      }
    }
  }

  // 3. 根据算法计算期望签名
  let expected: string;
  switch (algorithm) {
    case 'tiktok-shop': {
      const payload = clientKey + rawBody.toString('utf8');
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(payload);
      expected = hmac.digest('hex');
      break;
    }
    case 'hmac-sha256': {
      // 标准 HMAC-SHA256，结果 base64
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(rawBody);
      expected = hmac.digest('base64');
      break;
    }
    case 'hmac-sha256-hex': {
      // HMAC-SHA256，结果小写 hex（TikTok Shop 风格推断）
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(rawBody);
      expected = hmac.digest('hex');
      break;
    }
    case 'raw-body-hmac-sha256': {
      // 密钥包裹原始 body：secret + body + secret，再 HMAC-SHA256 hex
      const payload = secret + rawBody.toString('utf8') + secret;
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(payload);
      expected = hmac.digest('hex');
      break;
    }
    case 'tiktok-minis': {
      // TikTok Minis 格式: t=<timestamp>,s=<signature>
      const match = String(signatureHeader).match(/t=(\d+),s=([a-f0-9]+)/i);
      if (!match) {
        throw new WebhookSignatureError(
          `Invalid tiktok-signature format: ${signatureHeader}`
        );
      }
      const timestamp = match[1];
      const actualSignature = match[2].toLowerCase();
      tiktokMinisTimestamp = timestamp;

      // 防重放检查
      if (checkTimestamp) {
        const ts = parseInt(timestamp, 10);
        const now = Math.floor(Date.now() / 1000);
        if (Math.abs(now - ts) > timestampTolerance) {
          throw new WebhookSignatureError(
            `Timestamp out of tolerance: ${ts} vs ${now}`
          );
        }
      }

      // 尝试所有可能的签名算法组合（调试模式）
      const bodyStr = rawBody.toString('utf8');
      const attempts: Array<{ name: string; expected: string }> = [
        {
          name: 'hmac-sha256(body)',
          expected: crypto.createHmac('sha256', secret).update(rawBody).digest('hex'),
        },
        {
          name: 'hmac-sha256(timestamp+body)',
          expected: crypto.createHmac('sha256', secret).update(timestamp + bodyStr).digest('hex'),
        },
        {
          name: 'hmac-sha256(timestamp+"."+body)',
          expected: crypto.createHmac('sha256', secret).update(timestamp + '.' + bodyStr).digest('hex'),
        },
        {
          name: 'hmac-sha256(timestamp+":"+body)',
          expected: crypto.createHmac('sha256', secret).update(timestamp + ':' + bodyStr).digest('hex'),
        },
        {
          name: 'hmac-sha256(timestamp+"|"+body)',
          expected: crypto.createHmac('sha256', secret).update(timestamp + '|' + bodyStr).digest('hex'),
        },
        {
          name: 'sha256(secret+body)',
          expected: crypto.createHash('sha256').update(secret + bodyStr).digest('hex'),
        },
        {
          name: 'sha256(body+secret)',
          expected: crypto.createHash('sha256').update(bodyStr + secret).digest('hex'),
        },
      ];

      console.log('[SignatureDebug] tiktok-minis attempts:');
      console.log(`  actual signature: ${actualSignature}`);
      console.log(`  timestamp: ${timestamp}`);
      console.log(`  body length: ${bodyStr.length}`);
      let matchedAny = false;
      for (const a of attempts) {
        const matched = a.expected === actualSignature;
        console.log(
          `  ${a.name}: ${a.expected.substring(0, 20)}... matched=${matched}`
        );
        if (matched) {
          expected = a.expected;
          matchedAny = true;
          break;
        }
      }
      if (!matchedAny) {
        // 没有匹配的，抛错但把最接近的信息带出来
        throw new WebhookSignatureError(
          `Signature verification failed. ` +
          `Timestamp=${timestamp}, bodyLength=${bodyStr.length}, ` +
          `firstAttempt=${attempts[0].expected.substring(0, 20)}...`
        );
      }
      // tiktok-minis 在 case 内部已完成验证，直接返回
      return true;
    }
    default:
      throw new WebhookSignatureError(`Unsupported algorithm: ${algorithm}`);
  }

  // 4. 常量时间比较（防时序攻击）
  const actual = String(signatureHeader).trim();
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(actual);

  if (expectedBuf.length !== actualBuf.length) {
    throw new WebhookSignatureError('Signature length mismatch');
  }

  const isValid = crypto.timingSafeEqual(expectedBuf, actualBuf);
  if (!isValid) {
    throw new WebhookSignatureError('Signature verification failed');
  }

  return true;
}

/**
 * 尝试所有已知算法，返回匹配结果（用于调试）
 * 当收到真实 webhook 但不确定算法时，调用此函数排查
 */
export function tryAllSignatureAlgorithms(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
  clientKey: string,
  headerName = 'authorization'
): Array<{ algorithm: string; expected: string; matched: boolean }> {
  const signatureHeader = getHeaderCaseInsensitive(headers, headerName);
  if (!signatureHeader) {
    return [];
  }

  const actual = String(signatureHeader).trim();
  const algorithms = [
    {
      name: 'tiktok-shop',
      compute: () => {
        const payload = clientKey + rawBody.toString('utf8');
        const hmac = crypto.createHmac('sha256', secret);
        hmac.update(payload);
        return hmac.digest('hex');
      },
    },
    {
      name: 'hmac-sha256',
      compute: () => {
        const hmac = crypto.createHmac('sha256', secret);
        hmac.update(rawBody);
        return hmac.digest('base64');
      },
    },
    {
      name: 'hmac-sha256-hex',
      compute: () => {
        const hmac = crypto.createHmac('sha256', secret);
        hmac.update(rawBody);
        return hmac.digest('hex');
      },
    },
    {
      name: 'raw-body-hmac-sha256',
      compute: () => {
        const payload = secret + rawBody.toString('utf8') + secret;
        const hmac = crypto.createHmac('sha256', secret);
        hmac.update(payload);
        return hmac.digest('hex');
      },
    },
  ];

  return algorithms.map((algo) => {
    const expected = algo.compute();
    return {
      algorithm: algo.name,
      expected,
      matched: expected === actual,
    };
  });
}

/**
 * 大小写不敏感的 header 取值
 */
function getHeaderCaseInsensitive(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

/**
 * 签名验证错误
 */
export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}
