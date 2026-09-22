import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import type { AiOperation, Prisma } from '../generated/prisma/client.js';
import { ProjectScope } from '../projects/project.repository.js';
import type { AiParams } from './ai.schemas.js';

export class AiScope {
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly workspaceId: string,
  ) {}
  async context(p: AiParams, operation: AiOperation) {
    const resources = new ProjectScope(this.tx, this.workspaceId);
    const project = await resources.project(p.projectId);
    if (project.archived)
      throw new ConflictException('Restore the project before requesting AI assistance.');
    const task = p.taskId ? await resources.task(p.projectId, p.taskId, p.parentId ?? null) : null;
    const parent = p.parentId ? await resources.task(p.projectId, p.parentId, null) : null;
    if (operation === 'BREAKDOWN' && parent)
      throw new ConflictException('Subtasks cannot have further subtasks.');
    const rows = await this.tx.task.findMany({
      where: {
        workspaceId: this.workspaceId,
        projectId: p.projectId,
        ...(task ? { parentId: task.id } : {}),
      },
      select: { id: true, parentId: true, title: true, description: true, status: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: 41,
    });
    const counts =
      operation === 'SUMMARY'
        ? await this.tx.task.groupBy({
            by: ['status'],
            where: { workspaceId: this.workspaceId, projectId: p.projectId },
            _count: { _all: true },
          })
        : undefined;
    let truncated =
      rows.length > 40 ||
      project.description.length > 1000 ||
      (task?.description.length ?? 0) > 2000 ||
      (parent?.description.length ?? 0) > 500;
    const tasks = rows.slice(0, 40).map((row) => {
      truncated ||= row.description.length > 200;
      return { ...row, description: row.description.slice(0, 200) };
    });
    const context = {
      project: { name: project.name, description: project.description.slice(0, 1000) },
      task: task
        ? { title: task.title, description: task.description.slice(0, 2000), status: task.status }
        : undefined,
      parent: parent
        ? { title: parent.title, description: parent.description.slice(0, 500) }
        : undefined,
      counts: counts?.map((row) => ({ status: row.status, count: row._count._all })),
      tasks,
      truncated,
    };
    while (Buffer.byteLength(JSON.stringify(context)) > 24000 && context.tasks.length) {
      context.tasks.pop();
      context.truncated = true;
    }
    if (Buffer.byteLength(JSON.stringify(context)) > 24000)
      throw new ConflictException('Context is too large for this operation.');
    return {
      text: JSON.stringify(context),
      truncated: context.truncated,
      taskVersion: task?.version ?? null,
    };
  }
  async reserve(
    p: AiParams,
    userId: string,
    id: string,
    operation: AiOperation,
    taskVersion: number | null,
    provider: string,
    model: string,
  ) {
    if (
      await this.tx.aiRun.findUnique({
        where: { workspaceId_id: { workspaceId: this.workspaceId, id } },
      })
    )
      throw new ConflictException(
        'This AI request was already submitted. Generate a new preview explicitly.',
      );
    const now = Date.now();
    const [userMinute, workspaceHour, pending] = await Promise.all([
      this.tx.aiRun.count({
        where: { workspaceId: this.workspaceId, userId, createdAt: { gt: new Date(now - 60000) } },
      }),
      this.tx.aiRun.count({
        where: { workspaceId: this.workspaceId, createdAt: { gt: new Date(now - 3600000) } },
      }),
      this.tx.aiRun.count({
        where: {
          workspaceId: this.workspaceId,
          status: 'PENDING',
          createdAt: { gt: new Date(now - 60000) },
        },
      }),
    ]);
    if (userMinute >= 6 || workspaceHour >= 60 || pending >= 4)
      throw new HttpException('AI request limit reached. Wait before trying again.', 429);
    return this.tx.aiRun.create({
      data: {
        id,
        workspaceId: this.workspaceId,
        userId,
        projectId: p.projectId,
        taskId: p.taskId,
        taskVersion,
        operation,
        provider,
        model,
      },
    });
  }
  async complete(
    id: string,
    durationMs: number,
    usage?: { inputTokens: number; outputTokens: number },
  ) {
    const updated = await this.tx.aiRun.updateMany({
      where: { workspaceId: this.workspaceId, id, status: 'PENDING' },
      data: { status: 'SUCCEEDED', durationMs, ...usage },
    });
    if (!updated.count) throw new NotFoundException('AI request is unavailable.');
  }
}
