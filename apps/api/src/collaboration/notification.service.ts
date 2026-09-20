import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { WorkspaceAccess } from '../workspaces/workspace-access.service.js';
import { page } from '../projects/project.repository.js';
import { activitySelect } from './activity.writer.js';
import { WorkspaceSignals } from './workspace-signals.js';

@Injectable()
export class NotificationService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(WorkspaceAccess) private readonly access: WorkspaceAccess,
    @Inject(WorkspaceSignals) private readonly signals: WorkspaceSignals,
  ) {}

  async list(userId: string, offset: number) {
    const where = { recipientUserId: userId, recipient: { userId } };
    const [rows, unreadCount] = await this.db.$transaction(
      [
        this.db.notification.findMany({
          where,
          select: {
            id: true,
            workspaceId: true,
            type: true,
            createdAt: true,
            readAt: true,
            activity: { select: activitySelect },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: offset,
          take: 51,
        }),
        this.db.notification.count({ where: { ...where, readAt: null } }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { ...page(rows, offset), unreadCount };
  }

  async read(userId: string, id: string) {
    const notification = await this.db.notification.findFirst({
      where: { id, recipientUserId: userId, recipient: { userId } },
      select: { workspaceId: true },
    });
    if (!notification) throw new NotFoundException('Notification is unavailable.');
    await this.access.run(notification.workspaceId, userId, 'view', (scope) =>
      scope.bind((tx) =>
        tx.notification.updateMany({
          where: { id, workspaceId: scope.id, recipientUserId: userId, readAt: null },
          data: { readAt: new Date() },
        }),
      ),
    );
    this.signals.publish({ userId });
  }

  async readAll(userId: string) {
    await this.db.notification.updateMany({
      where: { recipientUserId: userId, recipient: { userId }, readAt: null },
      data: { readAt: new Date() },
    });
    this.signals.publish({ userId });
  }
}
