/**
 * TikTok Minis Webhook 签名验证模块
 *
 * ⚠️ 重要说明：
 * TikTok Minis 的 webhook 签名官方文档未公开检索到。
 * 以下实现基于 TikTok Shop 官方签名方式推断（HMAC-SHA256 + 小写 hex），
 * 并支持 3 种常见算法。如果默认配置验签失败，请用 signature-debug.ts 工具
 * 或按 README 调整 algorithm 配置。
 */
import type { SignatureConfig } from './types';
/**
 * 验证 Webhook 请求签名
 * @param rawBody  原始请求 body（Buffer，未解析的原始字节）
 * @param headers  请求头对象
 * @param config   签名配置
 * @returns        验证通过返回 true，否则抛出错误
 */
export declare function verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>, config: SignatureConfig): true;
/**
 * 尝试所有已知算法，返回匹配结果（用于调试）
 * 当收到真实 webhook 但不确定算法时，调用此函数排查
 */
export declare function tryAllSignatureAlgorithms(rawBody: Buffer, headers: Record<string, string | string[] | undefined>, secret: string, clientKey: string, headerName?: string): Array<{
    algorithm: string;
    expected: string;
    matched: boolean;
}>;
/**
 * 签名验证错误
 */
export declare class WebhookSignatureError extends Error {
    constructor(message: string);
}
//# sourceMappingURL=signature.d.ts.map