import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { WorkspaceRole } from '../generated/prisma/client.js';
import { WorkspaceAccess } from './workspace-access.service.js';
import { assignableRoles, can, canAssign, requirePermission } from './workspace.policy.js';
import { WorkspaceRepository } from './workspace.repository.js';

@Injectable()
export class WorkspaceService {
  constructor(
    @Inject(WorkspaceRepository) private readonly repository: WorkspaceRepository,
    @Inject(WorkspaceAccess) private readonly access: WorkspaceAccess,
  ) {}
  create(userId: string, name: string) {
    return this.repository.create(userId, name);
  }
  list(userId: string) {
    return this.repository.list(userId);
  }
  detail(id: string, userId: string) {
    return this.access.run(id, userId, 'view', async (scope, role) => ({
      workspace: await scope.workspace(),
      role,
      members: await scope.members(),
      invitations: can(role, 'manage')
        ? await scope.invitations(assignableRoles.filter((target) => canAssign(role, target)))
        : [],
      permissions: {
        rename: can(role, 'rename'),
        delete: can(role, 'delete'),
        leave: can(role, 'leave'),
        assignableRoles: assignableRoles.filter((target) => canAssign(role, target)),
      },
    }));
  }
  rename(id: string, userId: string, name: string) {
    return this.access.run(id, userId, 'rename', async (scope) => {
      const before = await scope.workspace();
      const after = await scope.rename(name);
      if (before.name !== name)
        await scope.audit(userId).record({
          action: 'WORKSPACE_UPDATED',
          entityType: 'WORKSPACE',
          entityId: id,
          metadata: { fields: ['name'] },
        });
      return after;
    });
  }
  async delete(id: string, userId: string) {
    await this.access.run(id, userId, 'delete', async (scope) => {
      await scope
        .audit(userId)
        .record({ action: 'WORKSPACE_DELETED', entityType: 'WORKSPACE', entityId: id });
      await scope.delete();
    });
  }
  async leave(id: string, userId: string) {
    await this.access.run(id, userId, 'leave', async (scope) => {
      await scope.remove(userId);
      await scope
        .audit(userId)
        .record({ action: 'MEMBER_LEFT', entityType: 'MEMBERSHIP', entityId: userId });
    });
  }
  async changeMember(id: string, actorId: string, targetId: string, role?: WorkspaceRole) {
    await this.access.run(id, actorId, 'manage', async (scope, actorRole) => {
      const target = await scope.membership(targetId);
      if (!target) throw new NotFoundException('Member is unavailable.');
      requirePermission(
        actorId !== targetId &&
          canAssign(actorRole, target.role) &&
          (!role || canAssign(actorRole, role)),
      );
      if (role) await scope.changeRole(targetId, role);
      else await scope.remove(targetId);
      if (!role || role !== target.role)
        await scope.audit(actorId).record({
          action: role ? 'MEMBER_ROLE_CHANGED' : 'MEMBER_REMOVED',
          entityType: 'MEMBERSHIP',
          entityId: targetId,
          metadata: { fromRole: target.role, ...(role ? { toRole: role } : {}) },
        });
    });
  }
}
