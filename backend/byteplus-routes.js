const express = require('express');
const router = express.Router();
const crypto = require('crypto');

const VOD_ENDPOINT = 'https://vod.byteplusapi.com';
const VOD_VERSION = '2023-01-01';

class BytePlusVodAdapter {
  constructor() {
    this.ak = process.env.BYTEPLUS_ACCESS_KEY_ID;
    let sk = process.env.BYTEPLUS_SECRET_ACCESS_KEY || '';
// Auto-decode if SK is base64-encoded
if (sk.endsWith('=') || /^[A-Za-z0-9+/]+$/.test(sk)) {
  try {
    const decoded = Buffer.from(sk, 'base64').toString('utf8');
    if (decoded && !decoded.includes('�')) sk = decoded;
  } catch (_) {}
}
this.sk = sk;
    this.spaceName = process.env.BYTEPLUS_VOD_SPACE_NAME || 'bigstar-drama';
    if (!this.ak || !this.sk) throw new Error('BYTEPLUS_ACCESS_KEY_ID and BYTEPLUS_SECRET_ACCESS_KEY required');
  }

  _sign(method, uri, queryString) {
    const date = new Date().toUTCString();
    const canonicalRequest = [
      method.toUpperCase(), uri, queryString || '',
      'host:vod.byteplusapi.com', 'host',
      crypto.createHash('sha256').update('').digest('hex'),
    ].join('\n');
    const stringToSign = `HMAC-SHA256\n${date}\n${crypto.createHash('sha256').update(canonicalRequest).digest('hex')}`;
    const signature = crypto.createHmac('sha256', this.sk).update(stringToSign).digest('hex');
    return { authorization: `HMAC-SHA256 Credential=${this.ak}, SignedHeaders=host, Signature=${signature}`, date };
  }

  async getPlayInfo(vid) {
    const params = new URLSearchParams({ Action: 'GetPlayInfo', Version: VOD_VERSION, Vid: vid });
    const queryString = params.toString();
    const { authorization, date } = this._sign('GET', '/', queryString);
    const response = await fetch(`${VOD_ENDPOINT}?${queryString}`, {
      method: 'GET',
      headers: { 'Host': 'vod.byteplusapi.com', 'X-Date': date, 'Authorization': authorization },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
    const epResult = await req.db.query(
      'SELECT id, "episodeNumber", "s3Key", "durationSec", "byteplusVid", "videoSource" FROM "Episode" WHERE "dramaId" = $1 ORDER BY "episodeNumber"',
      [dramaId]
    );
    const dramaResult = await req.db.query('SELECT "defaultVideoSource" FROM "Drama" WHERE id = $1', [dramaId]);
    const defaultSource = dramaResult.rows[0]?.defaultVideoSource || 'cloudfront';

    const results = [];
    for (const ep of epResult.rows) {
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

      if (!videoUrl) {
        videoUrl = `https://video.mordernmagic.com/${ep.s3Key}`;
      }

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
    const epResult = await req.db.query(
      'SELECT "s3Key", "byteplusVid", "videoSource", "dramaId" FROM "Episode" WHERE id = $1',
      [episodeId]
    );
    if (!epResult.rows.length) return res.status(404).json({ error: 'Not found' });
    const ep = epResult.rows[0];
    const dramaResult = await req.db.query('SELECT "defaultVideoSource" FROM "Drama" WHERE id = $1', [ep.dramaId]);
    const defaultSource = dramaResult.rows[0]?.defaultVideoSource || 'cloudfront';
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
