-- 留言板供品小物類型 (incense/lotus/fruit/tea/candle/note)
ALTER TABLE "Tribute" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'note';
