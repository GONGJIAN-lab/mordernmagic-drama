#!/usr/bin/env node
/**
 * list-workflows-v3.mjs
 * 试 4 种组合找能列工作流模板的方式:
 *   - ListWorkflows + POST (按 trigger v5 模式)
 *   - ListWorkflows + GET
 *   - ListWorkflowTemplates + GET
 *   - ListWorkflows + POST + skKey='buffer' (AWS 风格 SK)
 */

import crypto from 'node:crypto';
import https from 'node:https';
import fs from 'node:fs';

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
} catch (e) {}

const AK = process.env.BYTEPLUS_AK;
const SK = process.env.BYTEPLUS_SK;
const REGION = process.env.BYTEPLUS_REGION || 'ap-singapore-1';
const SERVICE = 'vod';
const HOST = 'open.byteplusapi.com';

if (!AK || !SK) { console.error('❌ 缺 AK/SK'); process.exit(1); }

function sha256Hex(d) { return crypto.createHash('sha256').update(d, 'utf8').digest('hex'); }
function hmac(k, d) { return crypto.createHmac('sha256', k).update(d, 'utf8').digest(); }
function uriEscape(s) {
  return encodeURIComponent(s).replace(/[^A-Za-z0-9_.~\-%]+/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}
function queryParamsToString(params) {
  return Object.keys(params).sort().map(key => {
    const val = params[key];
    if (typeof val === 'undefined' || val === null) return undefined;
    const e = uriEscape(key);
    if (!e) return undefined;
    if (Array.isArray(val)) return `${e}=${val.map(uriEscape).sort().join(`&${e}=`)}`;
    return `${e}=${uriEscape(val)}`;
  }).filter(v => v).join('&');
}
function trimHeaderValue(h) { return h.toString?.().trim().replace(/\s+/g, ' ') ?? ''; }
function getSignHeaders(o) {
  const keys = Object.keys(o);
  const signed = keys.slice().map(k => k.toLowerCase()).sort().join(';');
  const canonical = keys
    .sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1))
    .map(k => `${k.toLowerCase()}:${trimHeaderValue(o[k])}`).join('\n');
  return [signed, canonical];
}

function signRequest({ method, params, body = '', skKey = 'string' }) {
  const now = new Date();
  const xDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const shortDate = xDate.slice(0, 8);
  const sorted = queryParamsToString(params);
  const bodyHash = sha256Hex(body);
  const originHeaders = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Host': HOST,
    'X-Content-Sha256': bodyHash,
    'X-Date': xDate,
  };
  const [signedHeaders, canonicalHeaders] = getSignHeaders(originHeaders);
  const canonicalRequest = [method, '/', sorted, canonicalHeaders, '', signedHeaders, bodyHash].join('\n');
  const credentialScope = `${shortDate}/${REGION}/${SERVICE}/request`;
  const stringToSign = ['HMAC-SHA256', xDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');
  const skBytes = skKey === 'buffer' ? Buffer.from(SK, 'base64') : SK;
  const kDate = hmac(skBytes, shortDate);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, 'request');
  const signature = hmac(kSigning, stringToSign).toString('hex');
  const authorization = `HMAC-SHA256 Credential=${AK}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { headers: { ...originHeaders, Authorization: authorization }, sortedQuery: sorted, xDate };
}

function call({ method, action, version, skKey = 'string' }) {
  return new Promise((resolve) => {
    const params = { Action: action, Version: version, SpaceName: 'bigstar-drama', Limit: 100 };
    const { headers, sortedQuery, xDate } = signRequest({ method, params, body: '', skKey });
    const url = `https://${HOST}/?${sortedQuery}`;
    const body = '';
    const opts = {
      host: HOST,
      path: '/?' + sortedQuery,
      method,
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body, 'utf8') },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let parsed; try { parsed = JSON.parse(data); } catch { parsed = data; }
        const err = parsed?.ResponseMetadata?.Error;
        resolve({
          ok: !err,
          statusCode: res.statusCode,
          action, method, skKey, xDate,
          errorCode: err?.Code,
          errorMsg: err?.Message,
          rawBody: data.slice(0, 500),
          parsed,
        });
      });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    if (method === 'POST') req.write(body);
    req.end();
  });
}

async function main() {
  console.log('🧪 试 4 种组合找能列工作流的方式...\n');
  const tries = [
    { method: 'POST', action: 'ListWorkflows',      version: '2024-01-01', skKey: 'string' },
    { method: 'GET',  action: 'ListWorkflows',      version: '2024-01-01', skKey: 'string' },
    { method: 'GET',  action: 'ListWorkflowTemplates', version: '2024-01-01', skKey: 'string' },
    { method: 'GET',  action: 'ListWorkflows',      version: '2020-08-01', skKey: 'string' },
  ];

  let success = null;
  for (const t of tries) {
    const r = await call(t);
    if (r.ok) { success = r; break; }
    console.log(`   ✗ ${t.method} ${t.action} (${t.version}): ${r.errorCode || r.error || '?'} - ${r.errorMsg || ''}`);
  }

  if (!success) {
    console.log('\n❌ 4 种组合都失败');
    console.log('\n🅲️ 兜底方案：去 BytePlus 控制台直接看');
    console.log('   https://console.byteplus.com/vod/WorkflowTemplate/');
    console.log('   或 https://console.byteplus.com/  → 媒资处理 → 工作流模板');
    console.log('   复制模板名 + TemplateId 贴给我');
    return;
  }

  console.log(`\n✓ ${success.method} ${success.action} (Version=${success.parsed?.Result?.Version || '?'})`);
  const workflows = success.parsed?.Result?.Workflows || success.parsed?.Result?.Templates || success.parsed?.Result?.TemplateList || [];
  console.log(`✓ 找到 ${workflows.length} 个模板\n`);
  console.log('='.repeat(86));

  const enriched = workflows.map(wf => {
    const allText = ((wf.Name || '') + ' ' + (wf.Description || '')).toLowerCase();
    return {
      ...wf,
      _isHLS: allText.includes('hls'),
      _isMP4: allText.includes('mp4'),
      _isEncrypted: allText.includes('copyrighted') || allText.includes('encrypt') || allText.includes('drm'),
      _isMultiBitrate: allText.includes('multi-bitrate') || allText.includes('multi bitrate'),
    };
  });

  enriched.sort((a, b) => {
    if (a._isHLS !== b._isHLS) return b._isHLS ? 1 : -1;
    if (a._isEncrypted !== b._isEncrypted) return a._isEncrypted ? 1 : -1;
    return 0;
  });

  for (const wf of enriched) {
    const tid = wf.TemplateId || wf.WorkflowId || wf.Id || 'N/A';
    const tags = [];
    if (wf._isHLS) tags.push('🅷🅻🆂');
    else if (wf._isMP4) tags.push('🅼🅿④');
    if (wf._isMultiBitrate) tags.push('multi-bitrate');
    tags.push(wf._isEncrypted ? '🔒 ENCRYPTED' : '🔓 non-encrypted');
    console.log(`📌 ${wf.Name || '(unnamed)'}`);
    console.log(`   TemplateId: ${tid}`);
    if (wf.Type) console.log(`   Type:       ${wf.Type}`);
    console.log(`   Tags:       ${tags.join(', ')}`);
    if (wf.Description) console.log(`   Desc:       ${wf.Description.slice(0, 120)}${wf.Description.length > 120 ? '...' : ''}`);
    console.log('');
  }

  console.log('='.repeat(86));

  const hlsNonEnc = enriched.filter(w => w._isHLS && !w._isEncrypted);
  if (hlsNonEnc.length > 0) {
    console.log(`\n✅ ${hlsNonEnc.length} 个非加密 HLS 模板，复制 TemplateId 发我：\n`);
    for (const wf of hlsNonEnc) {
      console.log(`   → ${wf.Name}: ${wf.TemplateId || wf.WorkflowId || wf.Id}`);
    }
  } else {
    console.log('\n⚠️  没有非加密 HLS 模板');
    console.log('   所有 HLS 都是加密的。改走路线 B 或 C');
  }
}

main().catch(e => { console.error('❌', e.message); console.error(e.stack); process.exit(1); });