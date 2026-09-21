import type { Prisma, TaskStatus } from '../generated/prisma/client.js';
import { activitySelect } from '../collaboration/activity.writer.js';

const taskSelect = {
  id: true,
  projectId: true,
  parentId: true,
  title: true,
  status: true,
  updatedAt: true,
} as const;

function statusCounts(rows: { status: TaskStatus; _count: { _all: number } }[]) {
  const counts = { TODO: 0, IN_PROGRESS: 0, DONE: 0, total: 0 };
  for (const row of rows) {
    counts[row.status] = row._count._all;
    counts.total += row._count._all;
  }
  return counts;
}

export class DashboardScope {
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly workspaceId: string,
  ) {}

  async read(userId: string) {
    const active = {
      workspaceId: this.workspaceId,
      project: { workspaceId: this.workspaceId, archived: false },
    };
    const assigned = { ...active, assigneeId: userId, status: { not: 'DONE' as const } };
    const orderBy = [{ updatedAt: 'desc' as const }, { id: 'desc' as const }];
    const [projects, tasks, subtasks, assignedCount, assignedTasks, recentTasks, activity] =
      await Promise.all([
        this.tx.project.groupBy({
          by: ['archived'],
          where: { workspaceId: this.workspaceId },
          _count: { _all: true },
        }),
        this.tx.task.groupBy({
          by: ['status'],
          where: { ...active, parentId: null },
          _count: { _all: true },
        }),
        this.tx.task.groupBy({
          by: ['status'],
          where: { ...active, parentId: { not: null } },
          _count: { _all: true },
        }),
        this.tx.task.count({ where: assigned }),
        this.tx.task.findMany({ where: assigned, select: taskSelect, orderBy, take: 8 }),
        this.tx.task.findMany({ where: active, select: taskSelect, orderBy, take: 8 }),
        this.tx.activity.findMany({
          where: { workspaceId: this.workspaceId },
          select: activitySelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 8,
        }),
      ]);
    const activeProjects = projects.find((row) => !row.archived)?._count._all ?? 0;
    const archivedProjects = projects.find((row) => row.archived)?._count._all ?? 0;
    return {
      workspaceId: this.workspaceId,
      projects: {
        active: activeProjects,
        archived: archivedProjects,
        total: activeProjects + archivedProjects,
      },
      tasks: statusCounts(tasks),
      subtasks: statusCounts(subtasks),
      assignedToMe: { total: assignedCount, items: assignedTasks },
      recentTasks,
      activity,
    };
  }
}
