#!/usr/bin/env node
/**
 * list-workflows.mjs
 * 列出 bigstar-drama 空间下所有工作流模板，找到「非加密 HLS 多码率」模板
 *
 * 用法:
 *   node scripts/list-workflows.mjs
 *   或: ENV_FILE=/path/to/.env node scripts/list-workflows.mjs
 *
 * 依赖: 自动读取 ~/mordernmagic-drama/backend/.env 里的 BYTEPLUS_AK / BYTEPLUS_SK
 *       或 shell 环境变量
 */

import crypto from 'node:crypto';
import https from 'node:https';
import fs from 'node:fs';

// ===== 加载 .env =====
const ENV_FILE = process.env.ENV_FILE || '/Users/jian/mordernmagic-drama/backend/.env';
try {
  const raw = fs.readFileSync(ENV_FILE, 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^([^=#]+)=(.*)$/);
    if (!m) continue;
    const k = m[1].trim();
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
} catch (e) { /* .env 不存在就靠 shell env */ }

const AK = process.env.BYTEPLUS_AK;
const SK = process.env.BYTEPLUS_SK;
const REGION = process.env.BYTEPLUS_REGION || 'ap-singapore-1';
const SERVICE = 'vod';
const HOST = 'open.byteplusapi.com';

if (!AK || !SK) {
  console.error('❌ ERROR: BYTEPLUS_AK / BYTEPLUS_SK 未设置');
  console.error('   设置方法: export BYTEPLUS_AK=xxx BYTEPLUS_SK=yyy');
  console.error('   或放 .env 文件里 (当前查找: ' + ENV_FILE + ')');
  process.exit(1);
}

console.log(`✓ AK/SK 已加载 (env from: ${process.env.BYTEPLUS_AK ? 'shell' : '.env'})`);
console.log(`✓ Region: ${REGION}`);
console.log('');

// ===== 工具函数 =====
function sha256Hex(s) { return crypto.createHash('sha256').update(s, 'utf8').digest('hex'); }
function hmac(key, data) { return crypto.createHmac('sha256', key).update(data, 'utf8').digest(); }

function uriEscape(str) {
  return encodeURIComponent(str)
    .replace(/[^A-Za-z0-9_.~\-%]+/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function queryParamsToString(params) {
  return Object.keys(params).sort().map(key => {
    const val = params[key];
    if (typeof val === 'undefined' || val === null) return undefined;
    const escapedKey = uriEscape(key);
    if (!escapedKey) return undefined;
    if (Array.isArray(val)) return `${escapedKey}=${val.map(uriEscape).sort().join(`&${escapedKey}=`)}`;
    return `${escapedKey}=${uriEscape(val)}`;
  }).filter(v => v).join('&');
}

function signRequest(method, path, params) {
  const now = new Date();
  const isoDate = now.toISOString();
  const shortDate = isoDate.slice(0, 10).replace(/-/g, '');

  const queryString = queryParamsToString(params);
  const bodyHash = sha256Hex('');

  const canonicalHeaders = `host:${HOST}\n`;
  const signedHeaders = 'host';

  // [FIX] BytePlus 官方规范: CanonicalHeaders 和 SignedHeaders 之间多一个空行
  const canonicalRequest = [
    method, path, queryString, canonicalHeaders,
    '', signedHeaders, bodyHash,
  ].join('\n');

  const credentialScope = `${shortDate}/${REGION}/${SERVICE}/request`;
  const stringToSign = [
    'HMAC-SHA256', isoDate, credentialScope, sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac(`BytePlusV1${SK}`, shortDate);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, 'request');
  const signature = hmac(kSigning, stringToSign).toString('hex');

  return {
    queryString,
    authHeader: `HMAC-SHA256 Credential=${AK}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    isoDate,
  };
}

function callBytePlus(action, version, params = {}) {
  return new Promise((resolve, reject) => {
    const method = 'GET';
    const path = '/';

    const { queryString, authHeader, isoDate } = signRequest(method, path, params);
    const url = `https://${HOST}/?Action=${action}&Version=${version}&${queryString}`;

    const headers = {
      'Authorization': authHeader,
      'Host': HOST,
      'X-Date': isoDate,
    };

    const req = https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.ResponseMetadata?.Error) {
            reject(new Error(`${parsed.ResponseMetadata.Error.Code}: ${parsed.ResponseMetadata.Error.Message}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`Failed to parse response (${res.statusCode}): ${data.slice(0, 500)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(new Error('Request timeout (30s)')); });
  });
}

// ===== 主流程 =====
async function main() {
  console.log('🔍 列出 bigstar-drama 空间的工作流模板...\n');

  // 试多个 API 版本
  const versions = ['2024-01-01', '2023-01-01', '2020-08-01'];
  let result = null;
  let lastErr = null;
  let usedVersion = null;

  for (const version of versions) {
    try {
      result = await callBytePlus('ListWorkflows', version, {
        SpaceName: 'bigstar-drama',
        Limit: 100,
      });
      usedVersion = version;
      break;
    } catch (e) {
      lastErr = e;
    }
  }

  if (!result) {
    console.error('❌ ListWorkflows 在所有版本都失败:');
    console.error('   ' + lastErr?.message);
    process.exit(1);
  }

  // 保存原始响应
  fs.writeFileSync('/tmp/list-workflows-response.json', JSON.stringify(result, null, 2));

  const workflows = result.Result?.Workflows || result.Result?.Templates || result.Workflows || [];

  console.log(`✓ (Version=${usedVersion}) 找到 ${workflows.length} 个模板\n`);
  console.log('='.repeat(86));

  // 分类排序: HLS 在前, MP4 在后; 加密标记
  const enriched = workflows.map(wf => {
    const name = wf.Name || '';
    const desc = wf.Description || '';
    const allText = (name + ' ' + desc).toLowerCase();
    const isHLS = allText.includes('hls');
    const isMP4 = allText.includes('mp4') || allText.includes('h264');
    const isEncrypted = allText.includes('copyrighted') || allText.includes('encrypt') || allText.includes('drm');
    const isMultiBitrate = allText.includes('multi-bitrate') || allText.includes('multibitrate') || allText.includes('multi bitrate');
    return {
      ...wf,
      _isHLS: isHLS,
      _isMP4: isMP4,
      _isEncrypted: isEncrypted,
      _isMultiBitrate: isMultiBitrate,
    };
  });

  enriched.sort((a, b) => {
    if (a._isHLS !== b._isHLS) return b._isHLS ? 1 : -1;
    if (a._isEncrypted !== b._isEncrypted) return a._isEncrypted ? 1 : -1;
    return 0;
  });

  for (const wf of enriched) {
    const tid = wf.TemplateId || wf.WorkflowId || wf.Id || 'N/A';
    const name = wf.Name || '(unnamed)';
    const desc = wf.Description || '(no description)';

    const tags = [];
    if (wf._isHLS) tags.push('🅷🅻🆂');
    else if (wf._isMP4) tags.push('🅼🅿④');
    if (wf._isMultiBitrate) tags.push('multi-bitrate');
    if (wf._isEncrypted) tags.push('🔒 ENCRYPTED');
    else tags.push('🔓 non-encrypted');

    console.log(`📌 ${name}`);
    console.log(`   TemplateId: ${tid}`);
    if (wf.Type) console.log(`   Type:       ${wf.Type}`);
    console.log(`   Tags:       ${tags.join(', ')}`);
    if (desc && desc !== '(no description)') console.log(`   Desc:       ${desc.slice(0, 120)}${desc.length > 120 ? '...' : ''}`);
    console.log('');
  }

  console.log('='.repeat(86));

  // 推荐
  const hlsNonEnc = enriched.filter(w => w._isHLS && !w._isEncrypted);
  if (hlsNonEnc.length > 0) {
    console.log(`\n✅ 找到 ${hlsNonEnc.length} 个非加密 HLS 模板！`);
    console.log('   优先选带 "multi-bitrate" 的，复制 TemplateId 发我:\n');
    for (const wf of hlsNonEnc) {
      const tid = wf.TemplateId || wf.WorkflowId || wf.Id;
      console.log(`   → ${wf.Name}`);
      console.log(`     TemplateId: ${tid}\n`);
    }
  } else {
    console.log('\n⚠️  没找到非加密 HLS 模板');
    console.log('   只有加密 HLS（🔒）。改走路线 B 或 C');
  }

  console.log(`\n📄 原始响应已保存: /tmp/list-workflows-response.json`);
  console.log('   把上面你想用的 TemplateId 发我，下一步用它重触发 45 集');
}

main().catch(e => {
  console.error('\n❌ Error:', e.message);
  console.error(e.stack);
  process.exit(1);
});