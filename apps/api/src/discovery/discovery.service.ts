import { Inject, Injectable } from '@nestjs/common';
import { WorkspaceAccess } from '../workspaces/workspace-access.service.js';
import { DashboardScope } from './dashboard.repository.js';
import { SearchScope } from './search.repository.js';
import type { SearchInput } from './discovery.schemas.js';

@Injectable()
export class DiscoveryService {
  constructor(@Inject(WorkspaceAccess) private readonly access: WorkspaceAccess) {}
  dashboard(workspaceId: string, userId: string) {
    return this.access.run(workspaceId, userId, 'view', (scope) =>
      scope.bind((tx, id) => new DashboardScope(tx, id)).read(userId),
    );
  }
  search(workspaceId: string, userId: string, input: SearchInput) {
    return this.access.run(workspaceId, userId, 'view', (scope) =>
      scope.bind((tx, id) => new SearchScope(tx, id)).read(input),
    );
  }
}
