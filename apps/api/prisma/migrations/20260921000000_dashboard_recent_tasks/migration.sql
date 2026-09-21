-- Serves the bounded, most recently updated task lists within one workspace.
CREATE INDEX "tasks_workspace_id_updated_at_id_idx" ON "tasks"("workspace_id", "updated_at" DESC, "id" DESC);
