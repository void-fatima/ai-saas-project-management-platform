-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('PROJECT_CREATED', 'PROJECT_UPDATED', 'PROJECT_ARCHIVED', 'PROJECT_RESTORED', 'PROJECT_DELETED', 'TASK_CREATED', 'TASK_UPDATED', 'TASK_STATUS_CHANGED', 'TASK_ASSIGNED', 'TASK_DELETED', 'COMMENT_CREATED', 'COMMENT_UPDATED', 'COMMENT_DELETED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ASSIGNED', 'COMMENT');

-- CreateTable
CREATE TABLE "task_comments" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "author_user_id" UUID,
    "request_id" UUID NOT NULL,
    "body" VARCHAR(4000) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "type" "ActivityType" NOT NULL,
    "project_id" UUID NOT NULL,
    "task_id" UUID,
    "root_task_id" UUID,
    "subject" VARCHAR(200) NOT NULL,
    "from_status" "TaskStatus",
    "to_status" "TaskStatus",
    "dedup_key" VARCHAR(150) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "activity_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_comments_workspace_id_project_id_task_id_created_at_id_idx" ON "task_comments"("workspace_id", "project_id", "task_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "task_comments_workspace_id_author_user_id_request_id_key" ON "task_comments"("workspace_id", "author_user_id", "request_id");

-- CreateIndex
CREATE INDEX "activities_workspace_id_created_at_id_idx" ON "activities"("workspace_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "activities_workspace_id_project_id_task_id_created_at_id_idx" ON "activities"("workspace_id", "project_id", "task_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "activities_workspace_id_id_key" ON "activities"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "activities_workspace_id_dedup_key_key" ON "activities"("workspace_id", "dedup_key");

-- CreateIndex
CREATE INDEX "notifications_recipient_user_id_read_at_created_at_id_idx" ON "notifications"("recipient_user_id", "read_at", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_activity_id_recipient_user_id_key" ON "notifications"("activity_id", "recipient_user_id");

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_workspace_id_project_id_task_id_fkey" FOREIGN KEY ("workspace_id", "project_id", "task_id") REFERENCES "tasks"("workspace_id", "project_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_recipient_user_id_fkey" FOREIGN KEY ("workspace_id", "recipient_user_id") REFERENCES "workspace_memberships"("workspace_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_activity_id_fkey" FOREIGN KEY ("workspace_id", "activity_id") REFERENCES "activities"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
