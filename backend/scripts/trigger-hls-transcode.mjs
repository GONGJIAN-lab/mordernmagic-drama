#!/usr/bin/env node
/**
 * trigger-hls-transcode.mjs (v4 -- BytePlus 官方 SDK 风格 + 可切换 SK 处理)
 *
 * 凭据 inline(请 chmod 600)
 */

import crypto from 'node:crypto';
import https from 'node:https';
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';

// ---------- 凭据(inline,请勿外传) ----------
const AK = process.env.BYTEPLUS_AK;
const SK = process.env.BYTEPLUS_SK;

const HOST = 'open.byteplusapi.com';
const REGION = 'ap-singapore-1';
const SERVICE = 'vod';
const SPACE_NAME = 'bigstar-drama';
const DRAMA_SLUG = 'bigstar-drama';
const WORKFLOW_ID = '1ddda0dd053c4c7488926eb2eb77eb34';
const SLEEP_PER_VID = 300;

// ---------- BytePlus 官方 SDK 风格(参考 volcengine/auth/SignerV4) ----------
function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}
function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function uriEscape(str) {
  // [OK] 跟 BytePlus Node SDK 的 uriEscape 一致
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

function trimHeaderValue(header) {
  // [OK] 跟 SDK 的 trimHeaderValue 一致: trim + 折叠空白
  return header.toString?.().trim().replace(/\s+/g, ' ') ?? '';
}

function getSignHeaders(originHeaders) {
  const h = Object.keys(originHeaders);
  const signedHeaderKeys = h.slice().map(k => k.toLowerCase()).sort().join(';');
  const canonicalHeaders = h
    .sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1))
    .map(k => `${k.toLowerCase()}:${trimHeaderValue(originHeaders[k])}`)
    .join('\n');
  return [signedHeaderKeys, canonicalHeaders];
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

  const canonicalRequest = [
    method,
    '/',
    sorted,
    canonicalHeaders,
    signedHeaders,
    bodyHash,
  ].join('\n');

  const credentialScope = `${shortDate}/${REGION}/${SERVICE}/request`;
  const stringToSign = [
    'HMAC-SHA256',
    xDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  // [OK] SK 处理可切换
  // skKey = 'string' -> 直接用 60 字节 base64 字符串当 UTF-8 key(byteplus-routes.js v3.7 做法)
  // skKey = 'buffer' -> 先 base64 decode 成 43 字节 raw bytes(AWS-style 处理)
  const skKeyBytes = skKey === 'buffer' ? Buffer.from(SK, 'base64') : SK;

  const kDate = hmac(skKeyBytes, shortDate);
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

// ---------- HTTP POST ----------
function httpsPost({ host, path, headers, body }) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host,
      path,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Length': Buffer.byteLength(body, 'utf8'),
      },
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

async function callBytePlus(action, version, extraParams, skKey = 'string') {
  const params = { Action: action, Version: version, ...extraParams };
  const { headers, sortedQuery } = signRequest({ method: 'POST', params, body: '', skKey });

  // BytePlus VOD StartWorkflow: 参数全在 URL query string, body 必须空
  const body = '';

  const res = await httpsPost({
    host: HOST,
    path: '/?' + sortedQuery,
    headers,
    body,
  });

  let parsed;
  try { parsed = JSON.parse(res.body); } catch { parsed = res.body; }
  return { statusCode: res.statusCode, data: parsed };
}

// ---------- 读 vids ----------
const prisma = new PrismaClient();

async function loadVids() {
  const rows = await prisma.episode.findMany({
    where: {
      drama: { slug: DRAMA_SLUG },
      byteplusVid: { not: null },
    },
    select: { episodeNumber: true, byteplusVid: true },
    orderBy: { episodeNumber: 'asc' },
  });
  return rows.map(r => ({ episodeNumber: r.episodeNumber, vid: r.byteplusVid }));
}

// ---------- 主流程:先试 skKey='string'(60 字节 base64 字符串),失败再试 'buffer' ----------
async function main() {
  console.log('[SEARCH] 读取 vid 列表...');
  const rows = await loadVids();
  console.log(`[OK] ${rows.length} 个 vid 待转码`);

  if (rows.length === 0) {
    console.error('[FAIL] 数据库里没有 byteplus_vid');
    process.exit(1);
  }

  // [OK] 先试 skKey='string'(默认,byteplus-routes.js 做法)
  let skKey = 'string';
  console.log(`\n[TEST] 第一次试: skKey='${skKey}'(SK 当 UTF-8 字符串用)`);

  // 先拿 1 个 EP 测试
  const testRow = rows[0];
  console.log(`   test Vid: ${testRow.vid}`);
  const testRes = await callBytePlus('StartWorkflow', '2023-01-01', {
    Vid: testRow.vid,
    TemplateId: WORKFLOW_ID,
  }, skKey);

  if (testRes.statusCode === 200 && !testRes.data?.ResponseMetadata?.Error?.Code) {
    console.log(`   [OK] 测试成功! RunId: ${testRes.data?.Result?.RunId}`);
    console.log(`\n[BATCH] 批量触发 ${rows.length} 个 vid...`);
    await batchTrigger(rows, skKey);
  } else {
    const err = testRes.data?.ResponseMetadata?.Error || {};
    console.log(`   [FAIL] 测试失败: ${err.Code}: ${err.Message}`);

    if (err.Code === 'SignatureDoesNotMatch') {
      console.log(`\n[TEST] 第二次试: skKey='buffer'(SK 先 base64 decode)`);
      skKey = 'buffer';
      const testRes2 = await callBytePlus('StartWorkflow', '2023-01-01', {
        Vid: testRow.vid,
        TemplateId: WORKFLOW_ID,
      }, skKey);
      if (testRes2.statusCode === 200 && !testRes2.data?.ResponseMetadata?.Error?.Code) {
        console.log(`   [OK] 测试成功! RunId: ${testRes2.data?.Result?.RunId}`);
        console.log(`\n[BATCH] 批量触发 ${rows.length} 个 vid...`);
        await batchTrigger(rows, skKey);
      } else {
        const err2 = testRes2.data?.ResponseMetadata?.Error || {};
        console.log(`   [FAIL] 测试也失败: ${err2.Code}: ${err2.Message}`);
        console.log(`\n请把上面测试输出贴给我`);
      }
    }
  }
}

async function batchTrigger(rows, skKey) {
  const results = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    process.stdout.write(`\r[BATCH] ${i + 1}/${rows.length}(EP ${r.episodeNumber})...`);
    try {
      const res = await callBytePlus('StartWorkflow', '2023-01-01', {
        Vid: r.vid,
        TemplateId: WORKFLOW_ID,
      }, skKey);

      if (res.statusCode === 200 && !res.data?.ResponseMetadata?.Error?.Code) {
        results.push({ episodeNumber: r.episodeNumber, vid: r.vid, runId: res.data?.Result?.RunId || '', ok: true, error: '' });
      } else {
        const err = res.data?.ResponseMetadata?.Error || {};
        results.push({ episodeNumber: r.episodeNumber, vid: r.vid, runId: '', ok: false, error: `${err.Code}: ${err.Message}` });
      }
    } catch (e) {
      results.push({ episodeNumber: r.episodeNumber, vid: r.vid, runId: '', ok: false, error: `network: ${e.message}` });
    }

    if (i < rows.length - 1) {
      await new Promise(res => setTimeout(res, SLEEP_PER_VID));
    }
  }
  console.log();

  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
  const csvPath = `hls-transcode-runs-${ts}.csv`;
  const csvBody = results.map(r =>
    `${r.episodeNumber},${r.vid},${r.runId},${r.ok},${JSON.stringify(r.error)}`
  ).join('\n');
  fs.writeFileSync(csvPath, `episode_number,vid,run_id,ok,error\n${csvBody}\n`);

  const okCount = results.filter(r => r.ok).length;
  const failCount = results.length - okCount;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[OK] 触发完成: ${okCount} 成功 / ${failCount} 失败`);
  console.log(`[FILE] RunId 列表: ${csvPath}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
