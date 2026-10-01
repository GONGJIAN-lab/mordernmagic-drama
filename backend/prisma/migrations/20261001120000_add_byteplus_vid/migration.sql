-- Add byteplusVid to Episode (BytePlus video ID for VePlayer)
ALTER TABLE "Episode" ADD COLUMN IF NOT EXISTS "byteplusVid" TEXT;
