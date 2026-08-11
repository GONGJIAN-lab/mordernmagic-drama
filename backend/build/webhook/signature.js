"use strict";
/**
 * TikTok Minis Webhook 签名验证模块
 *
 * ⚠️ 重要说明：
 * TikTok Minis 的 webhook 签名官方文档未公开检索到。
 * 以下实现基于 TikTok Shop 官方签名方式推断（HMAC-SHA256 + 小写 hex），
 * 并支持 3 种常见算法。如果默认配置验签失败，请用 signature-debug.ts 工具
 * 或按 README 调整 algorithm 配置。
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookSignatureError = void 0;
exports.verifyWebhookSignature = verifyWebhookSignature;
exports.tryAllSignatureAlgorithms = tryAllSignatureAlgorithms;
const crypto_1 = __importDefault(require("crypto"));
/**
 * 验证 Webhook 请求签名
 * @param rawBody  原始请求 body（Buffer，未解析的原始字节）
 * @param headers  请求头对象
 * @param config   签名配置
 * @returns        验证通过返回 true，否则抛出错误
 */
function verifyWebhookSignature(rawBody, headers, config) {
    const { secret, clientKey, headerName = 'authorization', algorithm = 'tiktok-shop', checkTimestamp = true, timestampTolerance = 300, } = config;
    // 1. 取签名 header（大小写不敏感）
    const signatureHeader = getHeaderCaseInsensitive(headers, headerName);
    if (!signatureHeader) {
        throw new WebhookSignatureError(`Missing signature header: ${headerName}`);
    }
    // 2. 时间戳防重放检查（如果 header 中有 timestamp）
    // tiktok-minis 格式的时间戳在 signature header 中（t=...），单独处理
    let tiktokMinisTimestamp;
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
    let expected;
    switch (algorithm) {
        case 'tiktok-shop': {
            const payload = clientKey + rawBody.toString('utf8');
            const hmac = crypto_1.default.createHmac('sha256', secret);
            hmac.update(payload);
            expected = hmac.digest('hex');
            break;
        }
        case 'hmac-sha256': {
            // 标准 HMAC-SHA256，结果 base64
            const hmac = crypto_1.default.createHmac('sha256', secret);
            hmac.update(rawBody);
            expected = hmac.digest('base64');
            break;
        }
        case 'hmac-sha256-hex': {
            // HMAC-SHA256，结果小写 hex（TikTok Shop 风格推断）
            const hmac = crypto_1.default.createHmac('sha256', secret);
            hmac.update(rawBody);
            expected = hmac.digest('hex');
            break;
        }
        case 'raw-body-hmac-sha256': {
            // 密钥包裹原始 body：secret + body + secret，再 HMAC-SHA256 hex
            const payload = secret + rawBody.toString('utf8') + secret;
            const hmac = crypto_1.default.createHmac('sha256', secret);
            hmac.update(payload);
            expected = hmac.digest('hex');
            break;
        }
        case 'tiktok-minis': {
            // TikTok Minis 格式: t=<timestamp>,s=<signature>
            const match = String(signatureHeader).match(/t=(\d+),s=([a-f0-9]+)/i);
            if (!match) {
                throw new WebhookSignatureError(`Invalid tiktok-signature format: ${signatureHeader}`);
            }
            const timestamp = match[1];
            const actualSignature = match[2].toLowerCase();
            tiktokMinisTimestamp = timestamp;
            // 防重放检查
            if (checkTimestamp) {
                const ts = parseInt(timestamp, 10);
                const now = Math.floor(Date.now() / 1000);
                if (Math.abs(now - ts) > timestampTolerance) {
                    throw new WebhookSignatureError(`Timestamp out of tolerance: ${ts} vs ${now}`);
                }
            }
            // 签名算法: HMAC-SHA256(secret, timestamp + "." + body)
            const bodyStr = rawBody.toString('utf8');
            expected = crypto_1.default.createHmac('sha256', secret).update(timestamp + '.' + bodyStr).digest('hex');
            if (expected !== actualSignature) {
                throw new WebhookSignatureError('Signature verification failed. ' +
                    'Timestamp=' + timestamp + ', bodyLength=' + bodyStr.length);
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
    const isValid = crypto_1.default.timingSafeEqual(expectedBuf, actualBuf);
    if (!isValid) {
        throw new WebhookSignatureError('Signature verification failed');
    }
    return true;
}
/**
 * 尝试所有已知算法，返回匹配结果（用于调试）
 * 当收到真实 webhook 但不确定算法时，调用此函数排查
 */
function tryAllSignatureAlgorithms(rawBody, headers, secret, clientKey, headerName = 'authorization') {
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
                const hmac = crypto_1.default.createHmac('sha256', secret);
                hmac.update(payload);
                return hmac.digest('hex');
            },
        },
        {
            name: 'hmac-sha256',
            compute: () => {
                const hmac = crypto_1.default.createHmac('sha256', secret);
                hmac.update(rawBody);
                return hmac.digest('base64');
            },
        },
        {
            name: 'hmac-sha256-hex',
            compute: () => {
                const hmac = crypto_1.default.createHmac('sha256', secret);
                hmac.update(rawBody);
                return hmac.digest('hex');
            },
        },
        {
            name: 'raw-body-hmac-sha256',
            compute: () => {
                const payload = secret + rawBody.toString('utf8') + secret;
                const hmac = crypto_1.default.createHmac('sha256', secret);
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
function getHeaderCaseInsensitive(headers, name) {
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
class WebhookSignatureError extends Error {
    constructor(message) {
        super(message);
        this.name = 'WebhookSignatureError';
    }
}
exports.WebhookSignatureError = WebhookSignatureError;
//# sourceMappingURL=signature.js.map