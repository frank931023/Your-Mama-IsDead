-- 追悼頁可見度三態 + 邀請碼
DO $$ BEGIN
  CREATE TYPE "TabletVisibility" AS ENUM ('PUBLIC', 'UNLISTED', 'PRIVATE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "Tablet" ADD COLUMN IF NOT EXISTS "visibility" "TabletVisibility" NOT NULL DEFAULT 'UNLISTED';
ALTER TABLE "Tablet" ADD COLUMN IF NOT EXISTS "inviteCode" TEXT NOT NULL DEFAULT '';

-- 回填:原本公開的 → PUBLIC;其餘維持 UNLISTED (與舊行為「知連結可看」最接近)
UPDATE "Tablet" SET "visibility" = 'PUBLIC' WHERE "public" = true;

-- 每座塔位發一組 8 碼邀請碼 (大寫十六進位,好唸好抄)
UPDATE "Tablet" SET "inviteCode" = upper(substr(md5(random()::text || "tokenId"::text), 1, 8))
WHERE "inviteCode" = '';

CREATE INDEX IF NOT EXISTS "Tablet_visibility_idx" ON "Tablet"("visibility");
