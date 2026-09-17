CREATE TYPE "AccountTokenKind" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');
CREATE TABLE "account_tokens" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "kind" "AccountTokenKind" NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "issued_at" TIMESTAMPTZ(3) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "consumed_at" TIMESTAMPTZ(3),
  CONSTRAINT "account_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "account_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "account_tokens_token_hash_key" ON "account_tokens"("token_hash");
CREATE UNIQUE INDEX "account_tokens_user_id_kind_key" ON "account_tokens"("user_id", "kind");
CREATE INDEX "account_tokens_expires_at_idx" ON "account_tokens"("expires_at");
