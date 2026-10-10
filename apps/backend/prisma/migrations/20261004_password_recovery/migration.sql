ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "auth_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "reset_token_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "reset_expires_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reset_requested_at" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "users_reset_token_hash_key" ON "users"("reset_token_hash");
