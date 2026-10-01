-- Add albumId to Drama (TikTok/BytePlus album_id)
ALTER TABLE "Drama" ADD COLUMN IF NOT EXISTS "albumId" TEXT;

-- Add byteplusEpisodeId to Episode (TikTok/BytePlus episode_id)
ALTER TABLE "Episode" ADD COLUMN IF NOT EXISTS "byteplusEpisodeId" TEXT;
