const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { vodAdapter } = require('./byteplus-routes');
(async () => {
  if (!vodAdapter) { console.error('BytePlus adapter 未初始化'); process.exit(1); }
  const eps = await prisma.episode.findMany({
    where: { byteplusVid: { not: null } },
    select: { id: true, episodeNumber: true, byteplusVid: true, durationSec: true },
    orderBy: { episodeNumber: 'asc' },
  });
  console.log('total: ' + eps.length);
  let updated = 0;
  for (const ep of eps) {
    try {
      const bp = await vodAdapter.getPlayInfo(ep.byteplusVid);
      const real = bp?.Result?.PlayInfoList?.[0]?.Duration;
      if (typeof real !== 'number' || real <= 0) continue;
      const realInt = Math.round(real);
      if (realInt !== ep.durationSec) {
        await prisma.episode.update({ where: { id: ep.id }, data: { durationSec: realInt } });
        console.log('ep ' + String(ep.episodeNumber).padStart(2,'0') + ': ' + ep.durationSec + 's -> ' + realInt + 's');
        updated++;
      }
    } catch (e) { console.error('ep ' + ep.episodeNumber + ': ' + e.message); }
  }
  console.log('updated ' + updated + ' of ' + eps.length);
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
