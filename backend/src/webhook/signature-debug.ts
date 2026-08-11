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
import { tryAllSignatureAlgorithms } from './signature';

/**
 * 创建签名调试路由
 * 挂载点：POST /webhook/tiktok-debug
 *
 * 此路由不验签，只打印所有算法的匹配结果，方便排查。
 */
export function createSignatureDebugRouter(secret: string, clientKey: string): Router {
  const router = Router();

  router.post('/tiktok-debug', (req, res) => {
    const rawBody = req.body as Buffer;

    if (!Buffer.isBuffer(rawBody)) {
      res.status(400).json({ error: 'req.body is not a Buffer. Use express.raw({ type: "application/json" })' });
      return;
    }

    // 打印收到的所有 headers（方便排查 header 名）
    console.log('=== TikTok Webhook Debug ===');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Raw body:', rawBody.toString('utf8'));

    // 尝试所有已知算法
    const results = tryAllSignatureAlgorithms(rawBody, req.headers as Record<string, string | string[] | undefined>, secret, clientKey);

    console.log('Signature attempts:');
    for (const r of results) {
      console.log(`  ${r.algorithm}: expected=${r.expected}, matched=${r.matched}`);
    }

    const matched = results.find((r) => r.matched);
    if (matched) {
      console.log(`✅ MATCHED ALGORITHM: ${matched.algorithm}`);
    } else {
      console.log('❌ No algorithm matched. Possible reasons:');
      console.log('   - Wrong secret (check TIKTOK_WEBHOOK_SECRET env var)');
      console.log('   - Wrong header name (check X-TikTok-Signature or similar)');
      console.log('   - TikTok uses an algorithm not yet implemented');
    }

    console.log('=== End Debug ===');

    // 返回调试结果（不要用于生产环境）
    res.status(200).json({
      debug: true,
      matched: matched?.algorithm || null,
      attempts: results,
      headers: req.headers,
      bodyPreview: rawBody.toString('utf8').slice(0, 500),
    });
  });

  return router;
}

// ============================================================
// 临时集成示例（在正式路由前挂载，调试用）
// ============================================================
//
// import { createSignatureDebugRouter } from './webhook/signature-debug';
//
// app.use('/webhook/tiktok-debug', express.raw({ type: 'application/json' }));
// app.use('/webhook', createSignatureDebugRouter(process.env.TIKTOK_WEBHOOK_SECRET || ''));
//
// // 然后在 TikTok 后台把 webhook URL 临时改成 /webhook/tiktok-debug
// // 触发一次测试请求，看 Railway 日志确认算法
// // 确认后删除调试路由，改回正式路由
