import { randomUUID } from 'node:crypto';
import type { ActivityType, NotificationType, Prisma, Task } from '../generated/prisma/client.js';
import { AuditWriter } from '../audit/audit.writer.js';
import type { AuditInput } from '../audit/audit.schemas.js';

export const activitySelect = {
  id: true,
  workspaceId: true,
  type: true,
  projectId: true,
  taskId: true,
  rootTaskId: true,
  subject: true,
  fromStatus: true,
  toStatus: true,
  createdAt: true,
  actor: { select: { name: true } },
} as const;

export class ActivityWriter {
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly workspaceId: string,
    private readonly actorUserId: string,
    private readonly changed: () => void,
  ) {}

  async record(
    input: {
      type: ActivityType;
      projectId: string;
      subject: string;
      taskId?: string;
      rootTaskId?: string;
      fromStatus?: Task['status'];
      toStatus?: Task['status'];
      dedupKey?: string;
      audit?: Omit<AuditInput, 'action'>;
    },
    notification?: { type: NotificationType; recipients: (string | null)[] },
  ) {
    const { dedupKey = randomUUID(), audit, ...data } = input;
    const activity = await this.tx.activity.upsert({
      where: { workspaceId_dedupKey: { workspaceId: this.workspaceId, dedupKey } },
      create: { ...data, dedupKey, workspaceId: this.workspaceId, actorUserId: this.actorUserId },
      update: {},
    });
    await new AuditWriter(this.tx, this.workspaceId, this.actorUserId).record(
      {
        action: input.type,
        entityType:
          audit?.entityType ??
          (input.taskId ? (input.rootTaskId === input.taskId ? 'TASK' : 'SUBTASK') : 'PROJECT'),
        entityId: audit?.entityId ?? input.taskId ?? input.projectId,
        metadata: audit?.metadata ?? {
          projectId: input.projectId,
          ...(input.fromStatus ? { fromStatus: input.fromStatus } : {}),
          ...(input.toStatus ? { toStatus: input.toStatus } : {}),
        },
      },
      `activity:${activity.id}`,
    );
    if (notification) {
      const ids = [
        ...new Set(
          notification.recipients.filter((id): id is string => !!id && id !== this.actorUserId),
        ),
      ];
      const members = ids.length
        ? await this.tx.workspaceMembership.findMany({
            where: { workspaceId: this.workspaceId, userId: { in: ids } },
            select: { userId: true },
          })
        : [];
      if (members.length)
        await this.tx.notification.createMany({
          data: members.map(({ userId }) => ({
            workspaceId: this.workspaceId,
            recipientUserId: userId,
            activityId: activity.id,
            type: notification.type,
          })),
          skipDuplicates: true,
        });
    }
    this.changed();
    return activity;
  }

  async task(task: Task, type: ActivityType, previous?: Task) {
    await this.record(
      {
        type,
        projectId: task.projectId,
        taskId: task.id,
        rootTaskId: task.parentId ?? task.id,
        subject: task.title,
        dedupKey: `${task.id}:${task.version}:${type}`,
        audit: {
          entityType: task.parentId ? 'SUBTASK' : 'TASK',
          entityId: task.id,
          metadata: {
            projectId: task.projectId,
            parentId: task.parentId,
            version: task.version,
            ...(type === 'TASK_ASSIGNED'
              ? { assigneeId: task.assigneeId, previousAssigneeId: previous?.assigneeId ?? null }
              : {}),
            ...(type === 'TASK_STATUS_CHANGED'
              ? { fromStatus: previous?.status, toStatus: task.status }
              : {}),
          },
        },
        ...(type === 'TASK_STATUS_CHANGED'
          ? { fromStatus: previous?.status, toStatus: task.status }
          : {}),
      },
      type === 'TASK_ASSIGNED' ? { type: 'ASSIGNED', recipients: [task.assigneeId] } : undefined,
    );
  }

  async taskChanges(before: Task, after: Task) {
    if (before.status !== after.status) await this.task(after, 'TASK_STATUS_CHANGED', before);
    if (before.assigneeId !== after.assigneeId) await this.task(after, 'TASK_ASSIGNED', before);
    if (before.title !== after.title || before.description !== after.description)
      await this.task(after, 'TASK_UPDATED');
    if (before.position !== after.position && before.status === after.status)
      await new AuditWriter(this.tx, this.workspaceId, this.actorUserId).record({
        action: 'TASK_REORDERED',
        entityType: after.parentId ? 'SUBTASK' : 'TASK',
        entityId: after.id,
        metadata: { projectId: after.projectId, version: after.version, fields: ['position'] },
      });
    this.changed(); // Reordering is an invalidation, not activity noise.
  }
}
