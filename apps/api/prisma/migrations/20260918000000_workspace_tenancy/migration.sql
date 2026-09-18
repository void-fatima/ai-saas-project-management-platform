CREATE TYPE "WorkspaceRole" AS ENUM ('Owner', 'Admin', 'Manager', 'Member', 'Viewer');
CREATE TABLE workspaces (
  id UUID PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL
);
CREATE TABLE workspace_memberships (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  role "WorkspaceRole" NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX workspace_memberships_user_id_idx ON workspace_memberships(user_id);
CREATE UNIQUE INDEX workspace_single_owner ON workspace_memberships(workspace_id) WHERE role = 'Owner';
CREATE TABLE workspace_invitations (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
  email VARCHAR(254) NOT NULL,
  role "WorkspaceRole" NOT NULL CHECK (role <> 'Owner'),
  token_hash CHAR(64) NOT NULL,
  inviter_id UUID REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  issued_at TIMESTAMPTZ(3) NOT NULL,
  expires_at TIMESTAMPTZ(3) NOT NULL,
  consumed_at TIMESTAMPTZ(3),
  revoked_at TIMESTAMPTZ(3)
);
CREATE UNIQUE INDEX workspace_invitations_token_hash_key ON workspace_invitations(token_hash);
CREATE UNIQUE INDEX workspace_invitations_workspace_id_email_key ON workspace_invitations(workspace_id, email);
CREATE INDEX workspace_invitations_expires_at_idx ON workspace_invitations(expires_at);

-- Deferred so workspace + initial membership can be created in one transaction.
-- The partial unique index enforces at most one Owner; this enforces the matching Owner exists.
CREATE FUNCTION enforce_workspace_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'workspaces' THEN
    target_id := COALESCE(NEW.id, OLD.id);
  ELSE
    target_id := COALESCE(OLD.workspace_id, NEW.workspace_id);
  END IF;
  IF EXISTS (SELECT 1 FROM workspaces w WHERE w.id = target_id AND NOT EXISTS (
    SELECT 1 FROM workspace_memberships m WHERE m.workspace_id = w.id AND m.user_id = w.owner_id AND m.role = 'Owner'
  )) THEN
    RAISE EXCEPTION 'Workspace owner invariant violated' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER workspace_owner_required AFTER INSERT OR UPDATE ON workspaces
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_workspace_owner();
CREATE CONSTRAINT TRIGGER workspace_membership_owner_required AFTER INSERT OR UPDATE OR DELETE ON workspace_memberships
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_workspace_owner();
