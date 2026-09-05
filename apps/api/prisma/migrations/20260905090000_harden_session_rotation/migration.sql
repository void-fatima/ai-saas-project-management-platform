ALTER TABLE "sessions"
ADD COLUMN "previous_token_hash" CHAR(64),
ADD COLUMN "previous_token_expires_at" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "sessions_previous_token_hash_key" ON "sessions"("previous_token_hash");
