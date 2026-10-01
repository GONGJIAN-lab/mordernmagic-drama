#!/usr/bin/env node
// check-hls-result.mjs - 验证 BytePlus HLS workflow 转码结果
// 读 CSV 中的 RunId, 调 GetWorkflowExecutionResult API,
// 看 TranscodeInfos 里是否有 HLS 输出
import https from 'https';
import crypto from 'crypto';
import fs from 'fs';

const AK = process.env.BYTEPLUS_AK || '';
const SK = process.env.BYTEPLUS_SK || '';
const HOST = 'open.byteplusapi.com';
const REGION = 'ap-singapore-1';
const SERVICE = 'vod';
const API_VERSION = '2023-01-01';

if (!AK || !SK) { console.error('[ERR] 需要 BYTEPLUS_AK 和 BYTEPLUS_SK 环境变量'); process.exit(1); }

// ===== 签名工具 (复用 v5 逻辑) =====
function sha256Hex(s) { return crypto.createHash('sha256').update(s, 'utf8').digest('hex'); }
function hmac(key, data) {
  const k = typeof key === 'string' ? Buffer.from(key, 'utf8') : key;
  return crypto.createHmac('sha256', k).update(data, 'utf8').digest();
}
function uriEscape(str) {
  return encodeURIComponent(str)
    .replace(/[^A-Za-z0-9_.~\-%]+/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/[*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}
function queryParamsToString(params) {
  return Object.keys(params)
    .sort()
    .map(key => {
      const val = params[key];
      if (typeof val === 'undefined' || val === null) return undefined;
      const escapedKey = uriEscape(key);
      if (!escapedKey) return undefined;
      if (Array.isArray(val)) {
        return `${escapedKey}=${val.map(uriEscape).sort().join(`&${escapedKey}=`)}`;
      }
      return `${escapedKey}=${uriEscape(val)}`;
    })
    .filter(v => v)
    .join('&');
}
function trimHeaderValue(h) { return h.toString?.().trim().replace(/\s+/g, ' ') ?? ''; }

function getSignHeaders(originHeaders) {
  const h = Object.keys(originHeaders);
  const signedHeaderKeys = h.slice().map(k => k.toLowerCase()).sort().join(';');
  const canonicalHeaders = h
    .sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1))
    .map(k => `${k.toLowerCase()}:${trimHeaderValue(originHeaders[k])}`)
    .join('\n');
  return [signedHeaderKeys, canonicalHeaders];
}

function signRequest({ method, params, body = '' }) {
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

  const canonicalRequest = [
    method, '/', sorted, canonicalHeaders,
    '', // [FIX] BytePlus:CanonicalHeaders 和 SignedHeaders 之间多一个空行
    signedHeaders, bodyHash,
  ].join('\n');

  const credentialScope = `${shortDate}/${REGION}/${SERVICE}/request`;
  const stringToSign = ['HMAC-SHA256', xDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');

  const kDate = hmac(SK, shortDate);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, 'request');
  const signature = hmac(kSigning, stringToSign).toString('hex');

  const authorization = [
    'HMAC-SHA256',
    `Credential=${AK}/${credentialScope},`,
    `SignedHeaders=${signedHeaders},`,
    `Signature=${signature}`,
  ].join(' ');

  return { headers: { ...originHeaders, Authorization: authorization }, sortedQuery: sorted };
}

function httpsPost({ host, path, headers, body }) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host, path, method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body, 'utf8') },
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function getWorkflowResult(runId) {
  const params = { Action: 'GetWorkflowExecutionResult', Version: API_VERSION, RunId: runId };
  const { headers, sortedQuery } = signRequest({ method: 'POST', params, body: '' });
  const res = await httpsPost({ host: HOST, path: '/?' + sortedQuery, headers, body: '' });
  let parsed;
  try { parsed = JSON.parse(res.body); } catch { parsed = res.body; }
  return { statusCode: res.statusCode, data: parsed };
}

// ===== 读 CSV =====
function loadRuns() {
  const CSV = process.env.CSV_FILE;
  if (!CSV) { console.error('[ERR] 需要 CSV_FILE 环境变量 (e.g. CSV_FILE=hls-transcode-runs-XXX.csv)'); process.exit(1); }
  if (!fs.existsSync(CSV)) { console.error(`[ERR] CSV not found: ${CSV}`); process.exit(1); }
  const lines = fs.readFileSync(CSV, 'utf8').trim().split('\n');
  return lines.slice(1).map(line => {
    const c = line.split(',');
    return { episodeNumber: parseInt(c[0], 10), vid: c[1], runId: c[2], ok: c[3] };
  });
}

// ===== 主流程 =====
async function main() {
  const RUNS = loadRuns();
  console.log(`[LOAD] ${RUNS.length} 个 RunId (CSV: ${process.env.CSV_FILE})`);

  let hlsCount = 0, mp4Count = 0, pendingCount = 0, errorCount = 0;
  const samples = [];
  const errors = [];

  for (const run of RUNS) {
    if (run.ok !== 'true') continue;
    try {
      const { statusCode, data } = await getWorkflowResult(run.runId);
      if (statusCode !== 200 || !data || !data.Result) {
        errorCount++;
        if (errors.length < 3) errors.push({ ep: run.episodeNumber, runId: run.runId, statusCode, msg: data?.ResponseMetadata?.Error?.Message || 'no Result' });
        continue;
      }

      const result = data.Result;
      const infos = result.TranscodeInfos || result.TranscodeInfoList || [];
      const formats = infos.map(t => String(t.Format || t.format || '').toLowerCase()).filter(Boolean);
      const hasHls = formats.some(f => f.includes('hls'));
      const hasMp4 = formats.some(f => f === 'mp4' || f.includes('mp4'));

      if (hasHls) hlsCount++;
      else if (hasMp4) mp4Count++;
      else pendingCount++;

      if (samples.length < 3) {
        samples.push({
          ep: run.episodeNumber,
          runId: run.runId,
          status: result.Status,
          transcodeCount: infos.length,
          formats: [...new Set(formats)],
          definitions: [...new Set(infos.map(i => i.VideoStreamMeta?.Definition).filter(Boolean))],
          firstStoreUri: infos[0]?.StoreUri || '(none)',
          encrypted: infos[0]?.Encrypt ?? false,
          encryptKid: infos[0]?.Encryption?.Kid || '(none)',
        });
      }

      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      errorCount++;
      if (errors.length < 3) errors.push({ ep: run.episodeNumber, err: e.message });
    }
  }

  console.log('');
  console.log('============================================================');
  console.log(`[SUMMARY] 总计: ${RUNS.length}`);
  console.log(`  ✅ HLS 输出: ${hlsCount}`);
  console.log(`  ⚠️  MP4 输出 (不是 HLS!): ${mp4Count}`);
  console.log(`  ⏳ 转码中 / 未完成: ${pendingCount}`);
  console.log(`  ❌ 查询失败: ${errorCount}`);
  console.log('');
  console.log('[SAMPLE] 前 3 个结果:');
  samples.forEach(s => console.log(JSON.stringify(s, null, 2)));
  if (errors.length) {
    console.log('');
    console.log('[ERRORS] 前 3 个错误:');
    errors.forEach(e => console.log(JSON.stringify(e, null, 2)));
  }
  console.log('');
  console.log('============================================================');
  console.log('判定:');
  if (hlsCount === RUNS.length) console.log('✅ 全部 HLS, 可以改 backend playUrl 用 GetPlayplay Definition=Auto');
  else if (mp4Count > 0) console.log('❌ workflow 输出是 MP4, 不是 HLS! 检查 TemplateId 是不是 25524a2dae4541db93b2e891d7daf4b9');
  else if (pendingCount > 0) console.log('⏳ 部分还在转码, 5-10 分钟后再跑一次');
  else console.log('⚠️  数据异常, 看 sample 详情');
}

main().catch(e => { console.error(e); process.exit(1); });