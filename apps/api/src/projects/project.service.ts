import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import type { WorkspaceRole, TaskStatus } from '../generated/prisma/client.js';
import { WorkspaceAccess } from '../workspaces/workspace-access.service.js';
import { requirePermission } from '../workspaces/workspace.policy.js';
import { resourcePermissions } from './project.policy.js';
import { page, ProjectScope } from './project.repository.js';
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
    action: (scope: ProjectScope, role: WorkspaceRole) => Promise<T>,
  ) {
    return this.access.run(workspaceId, userId, 'view', (scope, role) =>
      action(
        scope.bind((tx, id) => new ProjectScope(tx, id)),
        role,
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
    return this.run(w, u, (scope, role) => {
      requirePermission(resourcePermissions(role).administer);
      return scope.createProject(u, input);
    });
  }
  detail(w: string, u: string, p: string) {
    return this.run(w, u, async (scope, role) => ({
      project: await scope.project(p),
      permissions: resourcePermissions(role),
    }));
  }
  update(w: string, u: string, p: string, input: ProjectUpdate) {
    return this.run(w, u, async (scope, role) => {
      await scope.project(p);
      requirePermission(resourcePermissions(role).administer);
      return scope.updateProject(p, input);
    });
  }
  delete(w: string, u: string, p: string) {
    return this.run(w, u, async (scope, role) => {
      await scope.project(p);
      requirePermission(resourcePermissions(role).administer);
      await scope.deleteProject(p);
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
    return this.run(w, u, async (scope, role) => {
      await this.context(scope, p, parent, true);
      requirePermission(resourcePermissions(role).edit);
      await this.assignment(scope, role, u, input.assigneeId, null);
      return scope.createTask(p, parent, u, input);
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
    return this.run(w, u, async (scope, role) => {
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
      return scope.updateTask(p, id, { ...data, position });
    });
  }
  move(w: string, u: string, p: string, id: string, parent: string | null, input: MoveInput) {
    return this.run(w, u, async (scope, role) => {
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
      return scope.updateTask(p, id, { status: input.status, position });
    });
  }
  deleteTask(w: string, u: string, p: string, id: string, parent: string | null) {
    return this.run(w, u, async (scope, role) => {
      await this.context(scope, p, parent, true);
      await scope.task(p, id, parent);
      requirePermission(resourcePermissions(role).deleteTasks);
      await scope.deleteTask(p, id);
    });
  }
}
