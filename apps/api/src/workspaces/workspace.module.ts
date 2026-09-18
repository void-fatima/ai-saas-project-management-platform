import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { WorkspaceController } from './workspace.controller.js';
import { WorkspaceService } from './workspace.service.js';
import { WorkspaceRepository } from './workspace.repository.js';
import { WorkspaceAccess } from './workspace-access.service.js';
import { WorkspaceInvitationService } from './workspace-invitation.service.js';

@Module({
  imports: [AuthModule],
  controllers: [WorkspaceController],
  providers: [WorkspaceService, WorkspaceRepository, WorkspaceAccess, WorkspaceInvitationService],
  exports: [WorkspaceAccess],
})
export class WorkspaceModule {}
