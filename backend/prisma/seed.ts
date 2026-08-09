import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const drama = await prisma.drama.upsert({
    where: { slug: 'chuan-jin-nue-wen' },
    update: {},
    create: {
      slug: 'chuan-jin-nue-wen',
      title: '穿进虐文，五个儿媳我来宠',
      cover: 'https://via.placeholder.com/300x450/1a365d/ffffff?text=Cover',
      description: '穿进虐文世界，用爱与智慧化解五个儿媳的困境',
      totalEpisodes: 45,
      priceCents: 999,
    },
  });

  const episodes = [];
  for (let i = 1; i <= 45; i++) {
    episodes.push({
      dramaId: drama.id,
      episodeNumber: i,
      s3Key: `dramas/chuan-jin-nue-wen/ep${String(i).padStart(2, '0')}.mp4`,
      durationSec: 120 + Math.floor(Math.random() * 60),
    });
  }

  for (const ep of episodes) {
    await prisma.episode.upsert({
      where: { dramaId_episodeNumber: { dramaId: ep.dramaId, episodeNumber: ep.episodeNumber } },
      update: {},
      create: ep,
    });
  }

  console.log(`Seeded drama: ${drama.title} with 45 episodes`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
