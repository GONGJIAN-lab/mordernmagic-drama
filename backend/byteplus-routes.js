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
      AccessKeyId: this.ak,
      SecretKey: this.sk,
      Region: 'ap-singapore-1',
      Service: 'vod',
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
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${text.substring(0, 500)}`);
      }
      let data;
      try { data = JSON.parse(text); } catch { throw new Error(`Invalid JSON: ${text.substring(0, 200)}`); }
      const result = data.Result || data.result;
      if (!result) throw new Error('No Result field');
      const list = result.PlayInfoList || result.playInfoList;
      if (!list || !list.length) {
        console.log('[BytePlus Debug] No PlayInfoList for Vid:', vid, 'Status:', result.Status || result.status);
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
