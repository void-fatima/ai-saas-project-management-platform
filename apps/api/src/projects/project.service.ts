import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { applyInput, type AiParams, type ApplyInput } from '../ai/ai.schemas.js';
import type { WorkspaceRole, TaskStatus } from '../generated/prisma/client.js';
import { WorkspaceAccess } from '../workspaces/workspace-access.service.js';
import { requirePermission } from '../workspaces/workspace.policy.js';
import { resourcePermissions } from './project.policy.js';
import { page, ProjectScope } from './project.repository.js';
import { ActivityWriter } from '../collaboration/activity.writer.js';
import type {
  MoveInput,
  ProjectInput,
  ProjectUpdate,
  TaskInput,
  TaskUpdate,
} from './project.schemas.js';

@Injectable()
export class ProjectService {
  constructor(@Inject(WorkspaceAccess) private readonly access: WorkspaceAccess) {}
  private run<T>(
    workspaceId: string,
    userId: string,
    action: (scope: ProjectScope, role: WorkspaceRole, activity: ActivityWriter) => Promise<T>,
  ) {
    return this.access.run(workspaceId, userId, 'view', (scope, role) =>
      action(
        scope.bind((tx, id) => new ProjectScope(tx, id)),
        role,
        scope.bind((tx, id) => new ActivityWriter(tx, id, userId, () => scope.markChanged())),
      ),
    );
  }
  list(w: string, u: string, offset = 0) {
    return this.run(w, u, async (scope, role) => ({
      ...page(await scope.projects(offset), offset),
      permissions: resourcePermissions(role),
    }));
  }
  members(w: string, u: string, offset = 0) {
    return this.run(w, u, async (scope) => page(await scope.members(offset), offset));
  }
  create(w: string, u: string, input: ProjectInput) {
    return this.run(w, u, async (scope, role, activity) => {
      requirePermission(resourcePermissions(role).administer);
      const project = await scope.createProject(u, input);
      await activity.record({
        type: 'PROJECT_CREATED',
        projectId: project.id,
        subject: project.name,
      });
      return project;
    });
  }
  detail(w: string, u: string, p: string) {
    return this.run(w, u, async (scope, role) => ({
      project: await scope.project(p),
      permissions: resourcePermissions(role),
    }));
  }
  update(w: string, u: string, p: string, input: ProjectUpdate) {
    return this.run(w, u, async (scope, role, activity) => {
      const before = await scope.project(p);
      requirePermission(resourcePermissions(role).administer);
      const after = await scope.updateProject(p, input);
      if (before.name !== after.name || before.description !== after.description)
        await activity.record({ type: 'PROJECT_UPDATED', projectId: p, subject: after.name });
      if (before.archived !== after.archived)
        await activity.record({
          type: after.archived ? 'PROJECT_ARCHIVED' : 'PROJECT_RESTORED',
          projectId: p,
          subject: after.name,
        });
      return after;
    });
  }
  delete(w: string, u: string, p: string) {
    return this.run(w, u, async (scope, role, activity) => {
      const project = await scope.project(p);
      requirePermission(resourcePermissions(role).administer);
      await scope.deleteProject(p);
      await activity.record({ type: 'PROJECT_DELETED', projectId: p, subject: project.name });
    });
  }
  private async context(scope: ProjectScope, p: string, parent: string | null, mutate: boolean) {
    const project = await scope.project(p);
    if (parent) await scope.task(p, parent, null);
    if (mutate && project.archived)
      throw new ConflictException('Restore this archived project before changing tasks.');
  }
  tasks(w: string, u: string, p: string, parent: string | null, offset = 0, status?: TaskStatus) {
    return this.run(w, u, async (scope) => {
      await this.context(scope, p, parent, false);
      return page(await scope.tasks(p, parent, offset, status), offset);
    });
  }
  task(w: string, u: string, p: string, id: string, parent: string | null = null) {
    return this.run(w, u, async (scope) => {
      await this.context(scope, p, parent, false);
      return scope.task(p, id, parent);
    });
  }
  private async assignment(
    scope: ProjectScope,
    role: WorkspaceRole,
    actor: string,
    next: string | null | undefined,
    previous: string | null,
  ) {
    if (next === undefined || next === previous) return;
    requirePermission(
      resourcePermissions(role).assignOthers ||
        (next === actor && (previous === null || previous === actor)) ||
        (next === null && previous === actor),
    );
    if (next && !(await scope.membership(next)))
      throw new BadRequestException('Assignee must be a current workspace member.');
  }
  createTask(w: string, u: string, p: string, parent: string | null, input: TaskInput) {
    return this.run(w, u, (scope, role, activity) =>
      this.createInScope(scope, role, activity, u, p, parent, input),
    );
  }
  private async createInScope(
    scope: ProjectScope,
    role: WorkspaceRole,
    activity: ActivityWriter,
    u: string,
    p: string,
    parent: string | null,
    input: TaskInput,
  ) {
    await this.context(scope, p, parent, true);
    requirePermission(resourcePermissions(role).edit);
    await this.assignment(scope, role, u, input.assigneeId, null);
    const task = await scope.createTask(p, parent, u, input);
    await activity.task(task, 'TASK_CREATED');
    if (task.assigneeId) await activity.task(task, 'TASK_ASSIGNED');
    return task;
  }
  applyBreakdown(p: AiParams, u: string, input: ApplyInput) {
    const parsed = applyInput.safeParse(input);
    if (!parsed.success || !p.taskId || p.parentId)
      throw new BadRequestException('Choose a root task and valid subtask drafts.');
    const taskId = p.taskId;
    const drafts = parsed.data.subtasks;
    const hash = createHash('sha256').update(JSON.stringify(drafts)).digest('hex');
    return this.run(p.workspaceId, u, async (scope, role, activity) => {
      await this.context(scope, p.projectId, taskId, true);
      requirePermission(resourcePermissions(role).edit);
      const task = await scope.task(p.projectId, taskId, null);
      const receipt = await scope.aiRequest(parsed.data.requestId, u, p.projectId, taskId);
      if (!receipt) throw new NotFoundException('Suggestion is unavailable.');
      if (receipt.status === 'APPLIED') {
        if (receipt.appliedHash !== hash)
          throw new ConflictException('This suggestion was already applied with different edits.');
        return { createdCount: receipt.createdCount };
      }
      if (receipt.status !== 'SUCCEEDED' || Date.now() - receipt.createdAt.getTime() > 15 * 60_000)
        throw new ConflictException('Generate a fresh suggestion before applying.');
      if (receipt.taskVersion !== task.version)
        throw new ConflictException('Task changed. Generate a fresh suggestion before applying.');
      if (
        await scope.duplicateSubtask(
          p.projectId,
          taskId,
          drafts.map((draft) => draft.title),
        )
      )
        throw new ConflictException('A subtask with one of these titles already exists.');
      for (const draft of drafts)
        await this.createInScope(scope, role, activity, u, p.projectId, taskId, draft);
      await scope.recordAiApply(receipt.id, hash, drafts.length);
      return { createdCount: drafts.length };
    });
  }
  updateTask(
    w: string,
    u: string,
    p: string,
    id: string,
    parent: string | null,
    input: TaskUpdate,
  ) {
    return this.run(w, u, async (scope, role, activity) => {
      await this.context(scope, p, parent, true);
      const task = await scope.task(p, id, parent);
      requirePermission(resourcePermissions(role).edit);
      if (task.version !== input.version)
        throw new ConflictException('Task changed. Reload before saving.');
      await this.assignment(scope, role, u, input.assigneeId, task.assigneeId);
      const data = {
        title: input.title,
        description: input.description,
        assigneeId: input.assigneeId,
        status: input.status,
      };
      const position =
        input.status && input.status !== task.status
          ? await scope.end(p, parent, input.status)
          : task.position;
      // Gaps left in the old column are intentional; order is numeric and deterministic.
      const updated = await scope.updateTask(p, id, { ...data, position });
      await activity.taskChanges(task, updated);
      return updated;
    });
  }
  move(w: string, u: string, p: string, id: string, parent: string | null, input: MoveInput) {
    return this.run(w, u, async (scope, role, activity) => {
      await this.context(scope, p, parent, true);
      const task = await scope.task(p, id, parent);
      requirePermission(resourcePermissions(role).edit);
      if (task.version !== input.version)
        throw new ConflictException('Task changed. Reload before moving.');
      if (input.beforeId === id)
        throw new BadRequestException('Choose a different destination task.');
      const before = input.beforeId ? await scope.task(p, input.beforeId, parent) : null;
      if (before && before.status !== input.status)
        throw new BadRequestException('Destination is in a different column.');
      const position = before?.position ?? (await scope.end(p, parent, input.status));
      if (before) await scope.shift(p, parent, input.status, position, 1);
      const updated = await scope.updateTask(p, id, { status: input.status, position });
      await activity.taskChanges(task, updated);
      return updated;
    });
  }
  deleteTask(w: string, u: string, p: string, id: string, parent: string | null) {
    return this.run(w, u, async (scope, role, activity) => {
      await this.context(scope, p, parent, true);
      const task = await scope.task(p, id, parent);
      requirePermission(resourcePermissions(role).deleteTasks);
      await scope.deleteTask(p, id);
      await activity.task(task, 'TASK_DELETED');
    });
  }
}
