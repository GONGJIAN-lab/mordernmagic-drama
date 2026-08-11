/**
 * Webhook 签名调试工具
 *
 * 用途：当你收到 TikTok 的真实 webhook 请求但不确定签名算法时，
 * 临时挂载此路由，打印所有算法的匹配结果，从而确认正确的算法配置。
 *
 * 使用方式：
 *   1. 把此文件复制到 backend/src/webhook/signature-debug.ts
 *   2. 在 index.ts 中临时挂载调试路由（见下方示例）
 *   3. 触发 TikTok 发送测试 webhook
 *   4. 查看 Railway 日志，找到匹配的算法
 *   5. 确认后删除调试路由，改用正式路由
 */
import { Router } from 'express';
/**
 * 创建签名调试路由
 * 挂载点：POST /webhook/tiktok-debug
 *
 * 此路由不验签，只打印所有算法的匹配结果，方便排查。
 */
export declare function createSignatureDebugRouter(secret: string): Router;
//# sourceMappingURL=signature-debug.d.ts.map