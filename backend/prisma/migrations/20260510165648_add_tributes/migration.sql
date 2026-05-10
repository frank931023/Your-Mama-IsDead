-- CreateTable
CREATE TABLE "Tribute" (
    "id" TEXT NOT NULL,
    "tokenId" BIGINT NOT NULL,
    "fromAddress" TEXT,
    "fromName" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tribute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Tribute_tokenId_idx" ON "Tribute"("tokenId");

-- CreateIndex
CREATE INDEX "Tribute_createdAt_idx" ON "Tribute"("createdAt");
