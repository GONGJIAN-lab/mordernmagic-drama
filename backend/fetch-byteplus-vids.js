const { vodAdapter } = require('./byteplus-routes');
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const medias = await vodAdapter.listMedia('bigstar-drama', 50);
  console.log(`Found ${medias.length} medias in bigstar-drama`);
console.log('Sample:', JSON.stringify(medias.slice(0, 5).map(m => ({vid: m.BasicInfo?.Vid, title: m.BasicInfo?.Title}))));

  const byEp = {};
  for (const m of medias) {
    const title = m.BasicInfo.Title || m.BasicInfo.Title || '';
    const m2 = title.match(/(\d+)\.mp4$/i) || title.match(/(\d+)\.mp4$/i);
    if (m2) {
      const epNum = parseInt(m2[1], 10);
      if (epNum >= 1 && epNum <= 45) byEp[epNum] = m.BasicInfo.Vid;
    }
  }
  console.log(`Matched vids: ${Object.keys(byEp).length} / 45`);

  const drama = await p.drama.findUnique({ where: { slug: 'bigstar-drama' } });
  if (!drama) { console.error('Drama bigstar-drama not found'); process.exit(1); }

  let updatedCount = 0;
  for (const [epNum, vid] of Object.entries(byEp)) {
    const r = await p.episode.updateMany({
      where: { dramaId: drama.id, episodeNumber: parseInt(epNum, 10) },
      data: { byteplusVid: vid },
    });
    updatedCount += r.count;
  }
  console.log(`Updated ${updatedCount} episodes with byteplusVid`);
  await p.$disconnect();
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
