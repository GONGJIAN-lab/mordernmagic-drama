const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  // 清理可能的旧数据
  await p.episode.deleteMany({ where: { drama: { slug: 'bigstar-drama' } } });
  await p.drama.deleteMany({ where: { slug: 'bigstar-drama' } });

  // 插入 Drama
  const d = await p.drama.create({
    data: {
      slug: 'bigstar-drama',
      title: '穿进虐文五个儿媳我来宠',
      cover: 'https://placehold.co/600x800/4A148C/D4AF37?text=BIG+STAR+Drama',
      description: 'A short drama series by BIG STAR MEDIA',
      totalEpisodes: 45,
      priceCents: 499,
      coverByteplusVid: 'v25dcbgm0018dap9loatgd60f0r51e9g',
    },
  });
  console.log('Drama id:', d.id);

  // 插入 45 集
  const eps = Array.from({ length: 45 }, (_, i) => ({
    dramaId: d.id,
    episodeNumber: i + 1,
    s3Key: `dramas/bigstar-drama/ep${(i + 1).toString().padStart(2, '0')}.mp4`,
    durationSec: 180,
  }));
  const r = await p.episode.createMany({ data: eps });
  console.log('Episodes inserted:', r.count);

  await p.$disconnect();
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
