-- 哀悼版 story 審核狀態 enum
DO $$ BEGIN
  CREATE TYPE "StoryStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'ONCHAIN');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Tablet 加「是否公開」欄 (給 /baibai 公開總覽過濾用)
ALTER TABLE "Tablet" ADD COLUMN IF NOT EXISTS "public" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "Tablet_public_idx" ON "Tablet"("public");

-- 哀悼版回憶
CREATE TABLE IF NOT EXISTS "MemorialStory" (
    "id" TEXT NOT NULL,
    "tokenId" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorName" TEXT,
    "authorAddress" TEXT,
    "photoUri" TEXT,
    "refDate" TEXT,
    "contentCid" TEXT NOT NULL,
    "status" "StoryStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MemorialStory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MemorialStory_tokenId_idx" ON "MemorialStory"("tokenId");
CREATE INDEX IF NOT EXISTS "MemorialStory_tokenId_status_idx" ON "MemorialStory"("tokenId", "status");
CREATE INDEX IF NOT EXISTS "MemorialStory_createdAt_idx" ON "MemorialStory"("createdAt");
