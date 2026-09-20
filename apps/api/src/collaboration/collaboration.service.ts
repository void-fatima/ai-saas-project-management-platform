import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { WorkspaceAccess } from '../workspaces/workspace-access.service.js';
import { requirePermission } from '../workspaces/workspace.policy.js';
import { page, ProjectScope } from '../projects/project.repository.js';
import type { CommentParams } from './collaboration.schemas.js';
import { ActivityWriter, activitySelect } from './activity.writer.js';
import type { Prisma } from '../generated/prisma/client.js';

const commentSelect = {
  id: true,
  authorUserId: true,
  body: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  author: { select: { name: true } },
} as const;

@Injectable()
export class CollaborationService {
  constructor(@Inject(WorkspaceAccess) private readonly access: WorkspaceAccess) {}

  private run<T>(
    p: CommentParams,
    userId: string,
    mutation: boolean,
    action: (context: {
      tx: Prisma.TransactionClient;
      task: Awaited<ReturnType<ProjectScope['task']>>;
      canComment: boolean;
      activity: ActivityWriter;
    }) => Promise<T>,
  ) {
    return this.access.run(p.workspaceId, userId, 'view', async (scope, role) => {
      const projects = scope.bind((tx, id) => new ProjectScope(tx, id));
      const project = await projects.project(p.projectId);
      const task = await projects.task(p.projectId, p.taskId, p.parentId ?? null);
      const canComment = role !== 'Viewer' && !project.archived;
      if (mutation) {
        requirePermission(role !== 'Viewer');
        if (project.archived)
          throw new ConflictException('Restore this archived project before commenting.');
      }
      return scope.bind((tx) =>
        action({
          tx,
          task,
          canComment,
          activity: new ActivityWriter(tx, scope.id, userId, () => scope.markChanged()),
        }),
      );
    });
  }

  list(p: CommentParams, userId: string, offset: number) {
    return this.run(p, userId, false, async ({ tx, canComment }) => ({
      ...page(
        await tx.taskComment.findMany({
          where: {
            workspaceId: p.workspaceId,
            projectId: p.projectId,
            taskId: p.taskId,
            deletedAt: null,
          },
          select: commentSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: offset,
          take: 51,
        }),
        offset,
      ),
      canComment,
    }));
  }

  create(p: CommentParams, userId: string, input: { body: string; requestId: string }) {
    return this.run(p, userId, true, async ({ tx, task, activity }) => {
      const prior = await tx.taskComment.findUnique({
        where: {
          workspaceId_authorUserId_requestId: {
            workspaceId: p.workspaceId,
            authorUserId: userId,
            requestId: input.requestId,
          },
        },
      });
      if (prior) {
        if (prior.taskId !== task.id || prior.deletedAt || prior.body !== input.body)
          throw new ConflictException(
            'This comment request was already used. Reload before retrying.',
          );
        return tx.taskComment.findUniqueOrThrow({
          where: {
            id: prior.id,
            workspaceId: p.workspaceId,
            projectId: p.projectId,
            taskId: p.taskId,
          },
          select: commentSelect,
        });
      }
      const comment = await tx.taskComment.create({
        data: {
          ...input,
          workspaceId: p.workspaceId,
          projectId: p.projectId,
          taskId: p.taskId,
          authorUserId: userId,
        },
        select: commentSelect,
      });
      await activity.record(
        {
          type: 'COMMENT_CREATED',
          projectId: p.projectId,
          taskId: task.id,
          rootTaskId: task.parentId ?? task.id,
          subject: task.title,
          dedupKey: `${comment.id}:created`,
        },
        { type: 'COMMENT', recipients: [task.creatorId, task.assigneeId] },
      );
      return comment;
    });
  }

  change(
    p: CommentParams & { commentId: string },
    userId: string,
    input: { version: number; body?: string },
  ) {
    return this.run(p, userId, true, async ({ tx, task, activity }) => {
      const comment = await tx.taskComment.findFirst({
        where: {
          id: p.commentId,
          workspaceId: p.workspaceId,
          projectId: p.projectId,
          taskId: p.taskId,
          deletedAt: null,
        },
      });
      if (!comment) throw new NotFoundException('Comment is unavailable.');
      requirePermission(comment.authorUserId === userId);
      if (comment.version !== input.version)
        throw new ConflictException('Comment changed. Reload before saving.');
      if (input.body === comment.body)
        return tx.taskComment.findUniqueOrThrow({
          where: {
            id: comment.id,
            workspaceId: p.workspaceId,
            projectId: p.projectId,
            taskId: p.taskId,
          },
          select: commentSelect,
        });
      const deleted = input.body === undefined;
      const updated = await tx.taskComment.update({
        where: {
          id: comment.id,
          workspaceId: p.workspaceId,
          projectId: p.projectId,
          taskId: p.taskId,
        },
        data: {
          body: input.body ?? '',
          deletedAt: deleted ? new Date() : null,
          version: { increment: 1 },
        },
        select: commentSelect,
      });
      await activity.record({
        type: deleted ? 'COMMENT_DELETED' : 'COMMENT_UPDATED',
        projectId: p.projectId,
        taskId: task.id,
        rootTaskId: task.parentId ?? task.id,
        subject: task.title,
        dedupKey: `${comment.id}:${updated.version}`,
      });
      return updated;
    });
  }

  activity(
    workspaceId: string,
    userId: string,
    q: { offset: number; projectId?: string; taskId?: string },
  ) {
    return this.access.run(workspaceId, userId, 'view', (scope) =>
      scope.bind(async (tx, id) => {
        // Historical references deliberately remain readable after a task/project is deleted.
        return page(
          await tx.activity.findMany({
            where: { workspaceId: id, projectId: q.projectId, taskId: q.taskId },
            select: activitySelect,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip: q.offset,
            take: 51,
          }),
          q.offset,
        );
      }),
    );
  }
}
