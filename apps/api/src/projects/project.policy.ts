import type { WorkspaceRole } from '../generated/prisma/client.js';

export function resourcePermissions(role: WorkspaceRole) {
  const administer = role === 'Owner' || role === 'Admin' || role === 'Manager';
  return { administer, edit: role !== 'Viewer', assignOthers: administer, deleteTasks: administer };
}
