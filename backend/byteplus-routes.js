const express = require('express');
const crypto = require('crypto');
const { Service } = require('@volcengine/openapi');

const router = express.Router();

const VOD_ENDPOINT = 'https://vod.byteplusapi.com';
const VOD_VERSION = '2023-01-01';



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
