CREATE TABLE IF NOT EXISTS "MemoryChunk" ("id" TEXT NOT NULL, "tokenId" BIGINT NOT NULL, "text" TEXT NOT NULL, "sourceUri" TEXT NOT NULL, "platform" TEXT, "speaker" TEXT, "embedding" vector(384), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "MemoryChunk_pkey" PRIMARY KEY ("id"));
CREATE INDEX IF NOT EXISTS "MemoryChunk_tokenId_idx" ON "MemoryChunk"("tokenId");
CREATE INDEX IF NOT EXISTS "MemoryChunk_embedding_hnsw_idx" ON "MemoryChunk" USING hnsw ("embedding" vector_cosine_ops);
