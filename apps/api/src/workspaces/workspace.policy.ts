import { ForbiddenException } from '@nestjs/common';
import type { WorkspaceRole } from '../generated/prisma/client.js';

export type WorkspaceCapability = 'view' | 'rename' | 'delete' | 'manage' | 'leave';
export const assignableRoles = ['Admin', 'Manager', 'Member', 'Viewer'] as const;
export function canAssign(actor: WorkspaceRole, target: WorkspaceRole): boolean {
  return target !== 'Owner' && (actor === 'Owner' || (actor === 'Admin' && target !== 'Admin'));
}
export function can(actor: WorkspaceRole, capability: WorkspaceCapability): boolean {
  switch (capability) {
    case 'view':
      return true;
    case 'leave':
      return actor !== 'Owner';
    case 'delete':
      return actor === 'Owner';
    case 'rename':
    case 'manage':
      return actor === 'Owner' || actor === 'Admin';
  }
}
export function requirePermission(allowed: boolean): void {
  if (!allowed) throw new ForbiddenException('Your workspace role does not permit this action.');
}
