import { randomUUID } from 'node:crypto';
import type { ActivityType, NotificationType, Prisma, Task } from '../generated/prisma/client.js';

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
    },
    notification?: { type: NotificationType; recipients: (string | null)[] },
  ) {
    const { dedupKey = randomUUID(), ...data } = input;
    const activity = await this.tx.activity.upsert({
      where: { workspaceId_dedupKey: { workspaceId: this.workspaceId, dedupKey } },
      create: { ...data, dedupKey, workspaceId: this.workspaceId, actorUserId: this.actorUserId },
      update: {},
    });
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
        ...(type === 'TASK_STATUS_CHANGED'
          ? { fromStatus: previous?.status, toStatus: task.status }
          : {}),
      },
      type === 'TASK_ASSIGNED' ? { type: 'ASSIGNED', recipients: [task.assigneeId] } : undefined,
    );
  }

  async taskChanges(before: Task, after: Task) {
    if (before.status !== after.status) await this.task(after, 'TASK_STATUS_CHANGED', before);
    if (before.assigneeId !== after.assigneeId) await this.task(after, 'TASK_ASSIGNED');
    if (before.title !== after.title || before.description !== after.description)
      await this.task(after, 'TASK_UPDATED');
    this.changed(); // Reordering is an invalidation, not activity noise.
  }
}
