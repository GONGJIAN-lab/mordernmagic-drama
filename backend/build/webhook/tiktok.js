"use strict";
/**
 * TikTok Minis Webhook Express 路由
 * 挂载点：POST /webhook/tiktok
 *
 * 使用方式：
 *   import { createTikTokWebhookRouter } from './webhook/tiktok';
 *   app.use('/webhook', createTikTokWebhookRouter(config));
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookService = exports.WebhookSignatureError = exports.verifyWebhookSignature = void 0;
exports.createTikTokWebhookRouter = createTikTokWebhookRouter;
const express_1 = require("express");
const signature_1 = require("./signature");
const service_1 = require("./service");
/**
 * 创建 TikTok Webhook 路由
 * @param config Webhook 处理器配置
 * @returns Express Router
 */
function createTikTokWebhookRouter(config) {
    const router = (0, express_1.Router)();
    const service = new service_1.WebhookService({ db: config.db, verbose: config.verbose });
    // 必须使用 raw body 才能正确验签（JSON parser 会改变 body 格式）
    // 在挂载此路由前，确保该路径不使用 express.json() 中间件
    router.post('/tiktok', async (req, res, _next) => {
        const rawBody = req.body;
        // 安全校验 1：必须是 Buffer（原始字节）
        if (!Buffer.isBuffer(rawBody)) {
            console.error('[TikTokWebhook] req.body is not a Buffer. Make sure you use express.raw({ type: "application/json" }) before this router.');
            res.status(400).json({ error: 'Invalid body format' });
            return;
        }
        try {
            // 安全校验 2：签名验证
            (0, signature_1.verifyWebhookSignature)(rawBody, req.headers, config.signature);
        }
        catch (err) {
            if (err instanceof signature_1.WebhookSignatureError) {
                console.warn('[TikTokWebhook] Signature verification failed:', err.message);
                res.status(401).json({ error: 'Unauthorized', message: err.message });
                return;
            }
            throw err;
        }
        // 安全校验 3：解析 JSON
        let payload;
        try {
            payload = JSON.parse(rawBody.toString('utf8'));
        }
        catch {
            res.status(400).json({ error: 'Invalid JSON' });
            return;
        }
        // 安全校验 4：字段基本校验
        if (!payload.event_type || !payload.event_id) {
            res.status(400).json({ error: 'Missing event_type or event_id' });
            return;
        }
        // 检查是否有自定义处理器
        const customHandler = config.customHandlers?.[payload.event_type];
        if (customHandler) {
            try {
                await customHandler(payload);
            }
            catch (err) {
                console.error('[TikTokWebhook] Custom handler error:', err);
                // 自定义处理器出错也返回 200，避免 TikTok 重试导致副作用
                // 但记录错误供排查
            }
            res.status(200).send('OK');
            return;
        }
        // 默认业务处理
        try {
            await service.handleEvent(payload);
            res.status(200).send('OK');
        }
        catch (err) {
            console.error('[TikTokWebhook] Business processing error:', err);
            // 业务处理出错也返回 200，因为幂等检查保证重试不会重复发货
            // 但把错误记到日志，供人工排查
            res.status(200).send('OK');
        }
    });
    return router;
}
// 导出子模块，方便用户按需使用
var signature_2 = require("./signature");
Object.defineProperty(exports, "verifyWebhookSignature", { enumerable: true, get: function () { return signature_2.verifyWebhookSignature; } });
Object.defineProperty(exports, "WebhookSignatureError", { enumerable: true, get: function () { return signature_2.WebhookSignatureError; } });
var service_2 = require("./service");
Object.defineProperty(exports, "WebhookService", { enumerable: true, get: function () { return service_2.WebhookService; } });
//# sourceMappingURL=tiktok.js.map