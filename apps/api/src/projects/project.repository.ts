import { NotFoundException } from '@nestjs/common';
import type { Prisma, TaskStatus } from '../generated/prisma/client.js';
import type { ProjectInput, ProjectUpdate, TaskInput } from './project.schemas.js';
import { AuditWriter } from '../audit/audit.writer.js';

export const pageSize = 50;
const taskInclude = {
  assignee: { select: { user: { select: { name: true } } } },
  _count: { select: { subtasks: true } },
} as const;

// Constructed only from a membership-authorized WorkspaceScope. No global resource lookups.
export class ProjectScope {
  constructor(
    private readonly tx: Prisma.TransactionClient,
    readonly workspaceId: string,
  ) {}
  audit(actorId: string) {
    return new AuditWriter(this.tx, this.workspaceId, actorId);
  }
  projects(offset: number) {
    return this.tx.project.findMany({
      where: { workspaceId: this.workspaceId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: offset,
      take: pageSize + 1,
    });
  }
  async project(id: string) {
    const project = await this.tx.project.findFirst({
      where: { workspaceId: this.workspaceId, id },
    });
    if (!project) throw new NotFoundException('Project is unavailable.');
    return project;
  }
  createProject(creatorId: string, input: ProjectInput) {
    return this.tx.project.create({ data: { ...input, workspaceId: this.workspaceId, creatorId } });
  }
  updateProject(id: string, data: ProjectUpdate) {
    return this.tx.project.update({
      where: { workspaceId_id: { workspaceId: this.workspaceId, id } },
      data,
    });
  }
  deleteProject(id: string) {
    return this.tx.project.delete({
      where: { workspaceId_id: { workspaceId: this.workspaceId, id } },
    });
  }
  members(offset: number) {
    return this.tx.workspaceMembership.findMany({
      where: { workspaceId: this.workspaceId },
      select: { userId: true, user: { select: { name: true, email: true } } },
      orderBy: { userId: 'asc' },
      skip: offset,
      take: pageSize + 1,
    });
  }
  membership(userId: string) {
    return this.tx.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId: this.workspaceId, userId } },
      select: { userId: true },
    });
  }
  aiRequest(id: string, userId: string, projectId: string, taskId: string) {
    return this.tx.aiRun.findFirst({
      where: {
        workspaceId: this.workspaceId,
        id,
        userId,
        projectId,
        taskId,
        operation: 'BREAKDOWN',
      },
    });
  }
  recordAiApply(id: string, appliedHash: string, createdCount: number) {
    return this.tx.aiRun.update({
      where: { workspaceId_id: { workspaceId: this.workspaceId, id } },
      data: { status: 'APPLIED', appliedHash, createdCount },
    });
  }
  duplicateSubtask(projectId: string, parentId: string, titles: string[]) {
    return this.tx.task.findFirst({
      where: {
        workspaceId: this.workspaceId,
        projectId,
        parentId,
        OR: titles.map((title) => ({ title: { equals: title, mode: 'insensitive' } })),
      },
      select: { id: true },
    });
  }
  tasks(projectId: string, parentId: string | null, offset: number, status?: TaskStatus) {
    return this.tx.task.findMany({
      where: { workspaceId: this.workspaceId, projectId, parentId, status },
      include: taskInclude,
      orderBy: [{ status: 'asc' }, { position: 'asc' }, { id: 'asc' }],
      skip: offset,
      take: pageSize + 1,
    });
  }
  async task(projectId: string, id: string, parentId: string | null) {
    const task = await this.tx.task.findFirst({
      where: { workspaceId: this.workspaceId, projectId, id, parentId },
      include: taskInclude,
    });
    if (!task) throw new NotFoundException('Task is unavailable.');
    return task;
  }
  async end(projectId: string, parentId: string | null, status: TaskStatus) {
    const result = await this.tx.task.aggregate({
      where: { workspaceId: this.workspaceId, projectId, parentId, status },
      _max: { position: true },
    });
    return (result._max.position ?? -1) + 1;
  }
  async createTask(
    projectId: string,
    parentId: string | null,
    creatorId: string,
    input: TaskInput,
  ) {
    return this.tx.task.create({
      data: {
        ...input,
        workspaceId: this.workspaceId,
        projectId,
        parentId,
        creatorId,
        position: await this.end(projectId, parentId, 'TODO'),
      },
      include: taskInclude,
    });
  }
  updateTask(projectId: string, id: string, data: Prisma.TaskUncheckedUpdateInput) {
    return this.tx.task.update({
      where: { workspaceId_projectId_id: { workspaceId: this.workspaceId, projectId, id } },
      data: { ...data, version: { increment: 1 } },
      include: taskInclude,
    });
  }
  deleteTask(projectId: string, id: string) {
    return this.tx.task.delete({
      where: { workspaceId_projectId_id: { workspaceId: this.workspaceId, projectId, id } },
    });
  }
  shift(
    projectId: string,
    parentId: string | null,
    status: TaskStatus,
    from: number,
    amount: number,
  ) {
    return this.tx.task.updateMany({
      where: {
        workspaceId: this.workspaceId,
        projectId,
        parentId,
        status,
        position: { gte: from },
      },
      data: { position: { increment: amount }, version: { increment: 1 } },
    });
  }
}

export function page<T>(rows: T[], offset: number) {
  return {
    items: rows.slice(0, pageSize),
    nextOffset: rows.length > pageSize ? offset + pageSize : null,
  };
}
