-- RAG 記憶來源擴充:chunk 標記來源類型 (chatlog | story),story 來源可帶照片 uri。
ALTER TABLE "MemoryChunk" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'chatlog';
ALTER TABLE "MemoryChunk" ADD COLUMN IF NOT EXISTS "mediaUri" TEXT;
CREATE INDEX IF NOT EXISTS "MemoryChunk_tokenId_kind_idx" ON "MemoryChunk"("tokenId", "kind");
