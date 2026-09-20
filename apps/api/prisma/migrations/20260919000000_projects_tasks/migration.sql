-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE');

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(5000) NOT NULL DEFAULT '',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "creator_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "parent_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(10000) NOT NULL DEFAULT '',
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "position" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "assignee_id" UUID,
    "creator_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "projects_workspace_id_created_at_id_idx" ON "projects"("workspace_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_workspace_id_id_key" ON "projects"("workspace_id", "id");

-- CreateIndex
CREATE INDEX "tasks_workspace_id_project_id_parent_id_status_position_id_idx" ON "tasks"("workspace_id", "project_id", "parent_id", "status", "position", "id");

-- CreateIndex
CREATE INDEX "tasks_workspace_id_assignee_id_idx" ON "tasks"("workspace_id", "assignee_id");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_workspace_id_project_id_id_key" ON "tasks"("workspace_id", "project_id", "id");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_project_id_fkey" FOREIGN KEY ("workspace_id", "project_id") REFERENCES "projects"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_project_id_parent_id_fkey" FOREIGN KEY ("workspace_id", "project_id", "parent_id") REFERENCES "tasks"("workspace_id", "project_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_assignee_id_fkey" FOREIGN KEY ("workspace_id", "assignee_id") REFERENCES "workspace_memberships"("workspace_id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE tasks ADD CONSTRAINT task_position_nonnegative CHECK (position >= 0);
ALTER TABLE tasks ADD CONSTRAINT task_version_positive CHECK (version > 0);

-- Assignment references membership, not merely a global user. Clear only the assignee,
-- preserving the required tenant column and incrementing the optimistic edit version.
CREATE FUNCTION clear_departing_assignments() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE tasks SET assignee_id = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE workspace_id = OLD.workspace_id AND assignee_id = OLD.user_id;
  RETURN OLD;
END;
$$;
CREATE TRIGGER clear_membership_assignments BEFORE DELETE ON workspace_memberships
  FOR EACH ROW EXECUTE FUNCTION clear_departing_assignments();

-- A parent is immutable and must be a root task in this same workspace/project.
-- Composite foreign keys independently enforce tenant/project relationships.
CREATE FUNCTION enforce_one_level_subtasks() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.parent_id IS DISTINCT FROM OLD.parent_id
      OR NEW.workspace_id <> OLD.workspace_id OR NEW.project_id <> OLD.project_id) THEN
    RAISE EXCEPTION 'Task relationships are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.parent_id IS NOT NULL AND (NEW.parent_id = NEW.id OR NOT EXISTS (
    SELECT 1 FROM tasks WHERE id = NEW.parent_id AND workspace_id = NEW.workspace_id
      AND project_id = NEW.project_id AND parent_id IS NULL
  )) THEN
    RAISE EXCEPTION 'Subtask parent must be a root task in the same project' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER task_parent_one_level BEFORE INSERT OR UPDATE OF parent_id, workspace_id, project_id ON tasks
  FOR EACH ROW EXECUTE FUNCTION enforce_one_level_subtasks();
