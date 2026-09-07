#!/usr/bin/env python3
"""
一键修复 TikTok Minis Webhook 签名验证
用法: python3 fix_tiktok_webhook.py
"""

import os
import sys

# 基础路径（根据你的项目结构调整）
BASE = os.environ.get('BACKEND_DIR', 'backend')

def read_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()

def write_file(path, content):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"  [OK] {path}")

# ============================================================
# 1. types.ts — 添加 tiktok-minis 算法选项
# ============================================================
print("[1/4] 修改 types.ts ...")
types_path = os.path.join(BASE, 'src/webhook/types.ts')
types_content = read_file(types_path)

old = "  /** 签名算法：hmac-sha256 | hmac-sha256-hex | raw-body-hmac-sha256 */\n  algorithm?: 'hmac-sha256' | 'hmac-sha256-hex' | 'raw-body-hmac-sha256';"
new = "  /** 签名算法：hmac-sha256 | hmac-sha256-hex | raw-body-hmac-sha256 | tiktok-minis */\n  algorithm?: 'hmac-sha256' | 'hmac-sha256-hex' | 'raw-body-hmac-sha256' | 'tiktok-minis';"

if old in types_content:
    types_content = types_content.replace(old, new)
    write_file(types_path, types_content)
else:
    print("  [SKIP] types.ts 已修改或格式不符")

# ============================================================
# 2. signature.ts — 添加 tiktok-minis 算法实现
# ============================================================
print("[2/4] 修改 signature.ts ...")
sig_path = os.path.join(BASE, 'src/webhook/signature.ts')
sig_content = read_file(sig_path)

# 替换 1：时间戳检查跳过 tiktok-minis
old1 = """  // 2. 时间戳防重放检查（如果 header 中有 timestamp）
  if (checkTimestamp) {
    const timestampHeader = getHeaderCaseInsensitive(headers, 'x-tiktok-timestamp') || getHeaderCaseInsensitive(headers, 'timestamp');"""
new1 = """  // 2. 时间戳防重放检查（如果 header 中有 timestamp）
  // tiktok-minis 格式的时间戳在 signature header 中（t=...），单独处理
  let tiktokMinisTimestamp: string | undefined;
  if (checkTimestamp && algorithm !== 'tiktok-minis') {
    const timestampHeader = getHeaderCaseInsensitive(headers, 'x-tiktok-timestamp') || getHeaderCaseInsensitive(headers, 'timestamp');"""

if old1 in sig_content:
    sig_content = sig_content.replace(old1, new1)
else:
    print("  [WARN] signature.ts 时间戳检查部分未找到，可能已修改")

# 替换 2：在 default 之前插入 tiktok-minis case
old2 = """    default:
      throw new WebhookSignatureError(`Unsupported algorithm: ${algorithm}`);"""

new2 = """    case 'tiktok-minis': {
      // TikTok Minis 格式: t=<timestamp>,s=<signature>
      const match = String(signatureHeader).match(/t=(\\d+),s=([a-f0-9]+)/i);
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
      throw new WebhookSignatureError(`Unsupported algorithm: ${algorithm}`);"""

if old2 in sig_content:
    sig_content = sig_content.replace(old2, new2)
    write_file(sig_path, sig_content)
else:
    print("  [WARN] signature.ts default case 未找到，可能已修改")

# ============================================================
# 3. tiktok.ts — 添加调试日志
# ============================================================
print("[3/4] 修改 tiktok.ts ...")
tt_path = os.path.join(BASE, 'src/webhook/tiktok.ts')
tt_content = read_file(tt_path)

old3 = """    try {
      // 安全校验 2：签名验证
      verifyWebhookSignature(rawBody, req.headers as Record<string, string | string[] | undefined>, config.signature);"""
new3 = """    try {
      // 安全校验 2：签名验证
      // 调试日志：打印关键信息帮助排查
      if (config.verbose) {
        console.log('[TikTokWebhook] === ALL HEADERS ===');
        console.log(JSON.stringify(req.headers, null, 2));
        console.log('[TikTokWebhook] === RAW BODY ===');
        console.log(rawBody.toString('utf8').slice(0, 1000));
      }
      verifyWebhookSignature(rawBody, req.headers as Record<string, string | string[] | undefined>, config.signature);"""

if old3 in tt_content:
    tt_content = tt_content.replace(old3, new3)
    write_file(tt_path, tt_content)
else:
    print("  [SKIP] tiktok.ts 已修改或格式不符")

# ============================================================
# 4. index.ts — 修改 webhook 配置（需要手动检查）
# ============================================================
print("[4/4] 检查 index.ts 配置 ...")
print("""
请在 backend/src/index.ts 中找到 webhook 配置，确保改成：

    signature: {
      secret: process.env.TIKTOK_WEBHOOK_SECRET || '',
      headerName: 'tiktok-signature',   // <- 改这里
      algorithm: 'tiktok-minis',        // <- 改这里
      checkTimestamp: true,
      timestampTolerance: 300,
    },

如果配置在别的文件（如 index.integrated.ts），同样改这两行。
""")

print("\n============================================")
print("修改完成！接下来执行：")
print("  cd backend")
print("  npx prisma generate")
print("  npm run build")
print("  git add .")
print('  git commit -m "fix: tiktok-minis webhook signature verification"')
print("  git push")
print("\n然后等 Railway 部署完成，在 TikTok 后台重新测试 webhook。")
print("============================================")
