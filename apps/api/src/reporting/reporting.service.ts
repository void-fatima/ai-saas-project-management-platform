import { Inject, Injectable } from '@nestjs/common';
import { WorkspaceAccess } from '../workspaces/workspace-access.service.js';
import { can, requirePermission } from '../workspaces/workspace.policy.js';
import { AuditScope } from '../audit/audit.repository.js';
import type { AuditQuery } from '../audit/audit.schemas.js';
import { ReportingScope } from './reporting.repository.js';
import type { ReportQuery } from './reporting.schemas.js';
@Injectable()
export class ReportingService {
  constructor(@Inject(WorkspaceAccess) private readonly access: WorkspaceAccess) {}
  report(workspaceId: string, userId: string, query: ReportQuery, projectId?: string) {
    return this.access.run(workspaceId, userId, 'view', async (scope, role) => ({
      ...(await scope.bind((tx, id) => new ReportingScope(tx, id)).read(query, projectId)),
      permissions: { audit: can(role, 'manage') },
    }));
  }
  audit(workspaceId: string, userId: string, query: AuditQuery) {
    return this.access.run(workspaceId, userId, 'view', (scope, role) => {
      requirePermission(can(role, 'manage'));
      return scope.bind((tx, id) => new AuditScope(tx, id)).read(query);
    });
  }
}
