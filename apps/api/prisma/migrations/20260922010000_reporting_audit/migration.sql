-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" VARCHAR(40) NOT NULL,
    "entity_type" VARCHAR(20) NOT NULL,
    "entity_id" UUID NOT NULL,
    "metadata" JSONB NOT NULL,
    "dedup_key" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_events_workspace_id_created_at_id_idx" ON "audit_events"("workspace_id", "created_at", "id");

-- No cascading foreign keys: identifiers remain historical after resource/account deletion.
-- Normal application SQL cannot rewrite, delete or truncate audit history.
CREATE FUNCTION reject_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Audit events are append-only' USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_events_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();

-- CreateIndex
CREATE UNIQUE INDEX "audit_events_workspace_id_dedup_key_key" ON "audit_events"("workspace_id", "dedup_key");
