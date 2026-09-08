const express = require('express');
const crypto = require('crypto');
const { Service } = require('@volcengine/openapi');

const router = express.Router();

const VOD_ENDPOINT = 'https://vod.byteplusapi.com';
const VOD_VERSION = '2023-01-01';

class BytePlusVodAdapter {
  constructor() {
    // Base64-decode the AK if needed (Railway env vars are base64-encoded)
    let ak = process.env.BYTEPLUS_ACCESS_KEY_ID || '';
    if (ak.length > 0 && !ak.startsWith('AKAP') && /^[A-Za-z0-9+/]+=*$/.test(ak)) {
      try { const d = Buffer.from(ak, 'base64').toString('utf8'); if (d.startsWith('AKAP')) ak = d; } catch (_) {}
    }
    let sk = process.env.BYTEPLUS_SECRET_ACCESS_KEY || '';
    if (sk.length > 0 && /^[A-Za-z0-9+/]+=*$/.test(sk)) {
      try { const d = Buffer.from(sk, 'base64').toString('utf8'); if (d && !d.includes('\uFFFD')) sk = d; } catch (_) {}
    }

    this.ak = ak;
    this.sk = sk;
    this.accountId = process.env.BYTEPLUS_ACCOUNT_ID;
    this.spaceName = process.env.BYTEPLUS_VOD_SPACE_NAME || 'bigstar-drama';

    if (!this.ak || !this.sk) throw new Error('BYTEPLUS_ACCESS_KEY_ID and BYTEPLUS_SECRET_ACCESS_KEY required');

    this.service = new Service({
      accessKeyId: this.ak,
      secretKey: this.sk,
      region: 'ap-singapore-1',
      serviceName: 'vod',
      Host: 'vod.byteplusapi.com',
    });
  }

  async getPlayInfo(vid) {
    try {
      const params = {
        Action: 'GetPlayInfo',
        Version: VOD_VERSION,
        query: { Vid: vid },
      };
      if (this.accountId) params.headers = { 'X-Account-Id': this.accountId };
      const response = await this.service.fetchOpenAPI(params);
      console.log('[BytePlus Debug] response type:', typeof response, 'ctor:', response && response.constructor && response.constructor.name, 'keys:', response && typeof response === 'object' ? Object.keys(response).slice(0, 30) : 'n/a');

      // 万能 unwrap: SDK 在不同 Node 版本下可能返回 Response/已解析 JSON/字符串/原始对象
      let data = response;
      if (data == null) throw new Error('SDK returned null/undefined');
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch { throw new Error('String not JSON: ' + data.substring(0, 200)); }
      } else if (typeof data.text === 'function') {
        const text = await data.text();
        if (data.status && data.status >= 400) throw new Error(`HTTP ${data.status}: ${text.substring(0, 500)}`);
        try { data = JSON.parse(text); } catch { throw new Error('text not JSON: ' + text.substring(0, 200)); }
      } else if (typeof data.json === 'function') {
        data = await data.json();
      } else if (data.body) {
        const body = Buffer.isBuffer(data.body) ? data.body.toString() : (typeof data.body === 'string' ? data.body : JSON.stringify(data.body));
        try { data = JSON.parse(body); } catch { throw new Error('body not JSON: ' + body.substring(0, 200)); }
      }
      if (!data || typeof data !== 'object') throw new Error('data not object: ' + typeof data);

      const result = data.Result || data.result;
      if (!result) throw new Error('No Result field in: ' + JSON.stringify(data).substring(0, 300));
      const list = result.PlayInfoList || result.playInfoList;
      if (!list || !list.length) {
        console.log('[BytePlus Debug] No PlayInfoList for Vid:', vid, 'Status:', result.Status || result.status, 'Result keys:', Object.keys(result));
        throw new Error('No PlayInfoList in response');
      }
      const info = list[0];
      const playUrl = info.MainPlayUrl || info.mainPlayUrl;
      if (!playUrl) {
        console.log('[BytePlus Debug] No MainPlayUrl in:', JSON.stringify(info).substring(0, 500));
        throw new Error('No MainPlayUrl in PlayInfo');
      }
      console.log('[BytePlus Debug] Vid:', vid, '->', playUrl.substring(0, 80));
      return { mainPlayUrl: playUrl, backupPlayUrl: info.BackupPlayUrl || info.backupPlayUrl, duration: info.Duration || info.duration };
    } catch (err) {
      const msg = err && err.message ? err.message : JSON.stringify(err);
      throw new Error(`BytePlus GetPlayInfo failed: ${msg.substring(0, 500)}`);
    }
  }
}

let vodAdapter;
try {
  vodAdapter = new BytePlusVodAdapter();
  console.log('[BytePlus] Adapter OK, space:', vodAdapter.spaceName, 'AK:', vodAdapter.ak.substring(0, 12) + '...', 'SK len:', vodAdapter.sk.length);
} catch (e) {
  console.warn('[BytePlus] Adapter skipped:', e.message);
}

router.get('/episodes/:dramaId', async (req, res) => {
  const { dramaId } = req.params;
  try {
    const epResult = await req.prisma.$queryRawUnsafe(
      `SELECT id, "episodeNumber", "durationSec", "s3Key", "byteplusVid", "videoSource"
       FROM "Episode" WHERE "dramaId" = $1 ORDER BY "episodeNumber" ASC`,
      dramaId
    );
    const dramaResult = await req.prisma.$queryRawUnsafe(
      `SELECT "defaultVideoSource" FROM "Drama" WHERE id = $1`,
      dramaId
    );
    const defaultSource = (dramaResult[0] && dramaResult[0].defaultVideoSource) || 'cloudfront';
    const results = [];
    for (const ep of epResult) {
      const source = ep.videoSource || defaultSource;
      let sourceLabel = source;
      let videoUrl = null;
      if (source === 'byteplus' && vodAdapter && ep.byteplusVid) {
        try {
          const info = await vodAdapter.getPlayInfo(ep.byteplusVid);
          videoUrl = info.mainPlayUrl;
        } catch (err) {
          console.error('[BytePlus] ep' + ep.episodeNumber + ' failed:', err.message);
          sourceLabel = 'byteplus (fallback)';
        }
      }
      if (!videoUrl) videoUrl = `https://video.mordernmagic.com/${ep.s3Key}`;
      results.push({ id: ep.id, episodeNumber: ep.episodeNumber, durationSec: ep.durationSec, videoUrl, source: sourceLabel });
    }
    res.json({ success: true, data: results });
  } catch (e) {
    console.error('[API] /episodes error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
