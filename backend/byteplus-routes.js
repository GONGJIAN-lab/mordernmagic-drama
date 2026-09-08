const express = require('express');
const router = express.Router();
const crypto = require('crypto');

const VOD_ENDPOINT = 'https://vod.byteplusapi.com';
const VOD_VERSION = '2023-01-01';

class BytePlusVodAdapter {
  constructor() {
    this.ak = process.env.BYTEPLUS_ACCESS_KEY_ID;
    let sk = process.env.BYTEPLUS_SECRET_ACCESS_KEY || '';
    if (sk.endsWith('=') || /^[A-Za-z0-9+/]+$/.test(sk)) {
      try { const d = Buffer.from(sk, 'base64').toString('utf8'); if (d && !d.includes('�')) sk = d; } catch (_) {}
    }
    this.sk = sk;
    this.spaceName = process.env.BYTEPLUS_VOD_SPACE_NAME || 'bigstar-drama';
    if (!this.ak || !this.sk) throw new Error('BYTEPLUS_ACCESS_KEY_ID and BYTEPLUS_SECRET_ACCESS_KEY required');
  }

  _sign(method, uri, queryObj) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const datetime = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
    const date = datetime.substring(0, 8);
    const region = 'ap-singapore-1';
    const service = 'vod';
    const credentialScope = `${date}/${region}/${service}`;

    const sortedQueryKeys = Object.keys(queryObj).sort();
    const canonicalQueryString = sortedQueryKeys
      .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(queryObj[k])}`)
      .join('&');

    const headers = { host: 'vod.byteplusapi.com', 'x-date': datetime };
    const sortedHeaderKeys = Object.keys(headers).sort();
    const canonicalHeaders = sortedHeaderKeys.map(k => `${k}:${headers[k].trim()}
`).join('');
    const signedHeaders = sortedHeaderKeys.join(';');

    const bodyHash = crypto.createHash('sha256').update('').digest('hex');

    const canonicalRequest = [
      method.toUpperCase(), uri, canonicalQueryString, canonicalHeaders, signedHeaders, bodyHash
    ].join('\n');

    const stringToSign = [
      'HMAC-SHA256', datetime, credentialScope,
      crypto.createHash('sha256').update(canonicalRequest).digest('hex')
    ].join('\n');

    const kDate = crypto.createHmac('sha256', this.sk).update(date).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
    const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
    const kSigning = crypto.createHmac('sha256', kService).update('request').digest();
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    return {
      authorization: `HMAC-SHA256 Credential=${this.ak}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      date: datetime,
    };
  }

  async getPlayInfo(vid) {
    const params = { Action: 'GetPlayInfo', Version: VOD_VERSION, Vid: vid };
    const { authorization, date } = this._sign('GET', '/', params);
    const sortedQueryString = Object.keys(params).sort()
      .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
      .join('&');
    const response = await fetch(`${VOD_ENDPOINT}?${sortedQueryString}`, {
      method: 'GET',
      headers: {
        'Host': 'vod.byteplusapi.com',
        'X-Date': date,
        'Authorization': authorization,
        'X-Account-Id': process.env.BYTEPLUS_ACCOUNT_ID,
      },
    });
    if (!response.ok) { const body = await response.text(); throw new Error(`HTTP ${response.status}: ${body.substring(0, 500)}`); }
    const data = await response.json();
    const result = data.Result || data.result;
    if (!result?.PlayInfoList?.length) throw new Error('No play info');
    const info = result.PlayInfoList[0];
    return { mainPlayUrl: info.MainPlayUrl, backupPlayUrl: info.BackupPlayUrl, duration: info.Duration };
  }
}

let vodAdapter;
try {
  vodAdapter = new BytePlusVodAdapter();
  console.log('[BytePlus] Adapter OK, space:', process.env.BYTEPLUS_VOD_SPACE_NAME);
} catch (e) {
  console.warn('[BytePlus] Adapter skipped:', e.message);
}

router.get('/episodes/:dramaId', async (req, res) => {
  const { dramaId } = req.params;
  try {
    const epResult = await req.prisma.$queryRawUnsafe(
      'SELECT id, "episodeNumber", "s3Key", "durationSec", "byteplusVid", "videoSource" FROM "Episode" WHERE "dramaId" = $1 ORDER BY "episodeNumber"',
      dramaId
    );
    const dramaResult = await req.prisma.$queryRawUnsafe(
      'SELECT "defaultVideoSource" FROM "Drama" WHERE id = $1',
      dramaId
    );
    const defaultSource = dramaResult[0]?.defaultVideoSource || 'cloudfront';

    const results = [];
    for (const ep of epResult) {
      const source = ep.videoSource || defaultSource;
      let videoUrl = null;
      let sourceLabel = source;

      if (source === 'byteplus' && vodAdapter && ep.byteplusVid) {
        try {
          const info = await vodAdapter.getPlayInfo(ep.byteplusVid);
          videoUrl = info.mainPlayUrl;
        } catch (err) {
          console.warn(`[BytePlus] ep${ep.episodeNumber} failed:`, err.message);
          sourceLabel = 'byteplus (fallback)';
        }
      }

      if (!videoUrl) videoUrl = `https://video.mordernmagic.com/${ep.s3Key}`;

      results.push({ id: ep.id, episodeNumber: ep.episodeNumber, durationSec: ep.durationSec, videoUrl, source: sourceLabel });
    }
    res.json({ success: true, data: results });
  } catch (err) {
    console.error('[Episodes]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/video/:episodeId', async (req, res) => {
  const { episodeId } = req.params;
  try {
    const epResult = await req.prisma.$queryRawUnsafe(
      'SELECT "s3Key", "byteplusVid", "videoSource", "dramaId" FROM "Episode" WHERE id = $1',
      episodeId
    );
    if (!epResult.length) return res.status(404).json({ error: 'Not found' });
    const ep = epResult[0];
    const dramaResult = await req.prisma.$queryRawUnsafe(
      'SELECT "defaultVideoSource" FROM "Drama" WHERE id = $1',
      ep.dramaId
    );
    const defaultSource = dramaResult[0]?.defaultVideoSource || 'cloudfront';
    const source = ep.videoSource || defaultSource;

    let redirectUrl = `https://video.mordernmagic.com/${ep.s3Key}`;

    if (source === 'byteplus' && vodAdapter && ep.byteplusVid) {
      try {
        const info = await vodAdapter.getPlayInfo(ep.byteplusVid);
        redirectUrl = info.mainPlayUrl;
      } catch (err) {
        console.warn('[BytePlus] redirect fallback:', err.message);
      }
    }
    res.redirect(302, redirectUrl);
  } catch (err) {
    console.error('[Video]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
