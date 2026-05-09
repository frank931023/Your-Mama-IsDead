-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'UPLOADED', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "Tablet" (
    "tokenId" BIGINT NOT NULL,
    "owner" TEXT NOT NULL,
    "parentTokenId" BIGINT,
    "tokenURI" TEXT NOT NULL,
    "artifactURI" TEXT,
    "metadataJson" JSONB,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tablet_pkey" PRIMARY KEY ("tokenId")
);

-- CreateTable
CREATE TABLE "TrainingJob" (
    "id" TEXT NOT NULL,
    "tokenId" BIGINT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "artifactCid" TEXT,
    "artifactURI" TEXT,
    "txHash" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "address" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "Session" (
    "nonce" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("nonce")
);

-- CreateIndex
CREATE INDEX "Tablet_owner_idx" ON "Tablet"("owner");

-- CreateIndex
CREATE INDEX "Tablet_parentTokenId_idx" ON "Tablet"("parentTokenId");

-- CreateIndex
CREATE INDEX "TrainingJob_tokenId_idx" ON "TrainingJob"("tokenId");

-- CreateIndex
CREATE INDEX "TrainingJob_status_idx" ON "TrainingJob"("status");

-- CreateIndex
CREATE INDEX "Session_address_idx" ON "Session"("address");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- AddForeignKey
ALTER TABLE "TrainingJob" ADD CONSTRAINT "TrainingJob_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Tablet"("tokenId") ON DELETE RESTRICT ON UPDATE CASCADE;
