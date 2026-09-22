import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { WorkspaceModule } from '../workspaces/workspace.module.js';
import { AuditController, ReportingController } from './reporting.controller.js';
import { ReportingService } from './reporting.service.js';
@Module({
  imports: [AuthModule, WorkspaceModule],
  controllers: [ReportingController, AuditController],
  providers: [ReportingService],
})
export class ReportingModule {}
