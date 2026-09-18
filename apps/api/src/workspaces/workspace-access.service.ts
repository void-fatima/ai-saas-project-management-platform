import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { WorkspaceRole } from '../generated/prisma/client.js';
import { can, requirePermission, type WorkspaceCapability } from './workspace.policy.js';
import { WorkspaceRepository, type WorkspaceScope } from './workspace.repository.js';

@Injectable()
export class WorkspaceAccess {
  constructor(@Inject(WorkspaceRepository) private readonly repository: WorkspaceRepository) {}
  run<T>(
    workspaceId: string,
    userId: string,
    capability: WorkspaceCapability,
    action: (scope: WorkspaceScope, role: WorkspaceRole) => Promise<T>,
  ): Promise<T> {
    return this.repository.locked(workspaceId, async (scope) => {
      const membership = await scope.membership(userId);
      if (!membership) throw new NotFoundException('Workspace is unavailable.');
      requirePermission(can(membership.role, capability));
      return action(scope, membership.role);
    });
  }
}
