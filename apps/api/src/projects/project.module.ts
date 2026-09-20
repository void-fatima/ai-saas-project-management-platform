import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { WorkspaceModule } from '../workspaces/workspace.module.js';
import { ProjectController, TaskController } from './project.controller.js';
import { ProjectService } from './project.service.js';

@Module({
  imports: [AuthModule, WorkspaceModule],
  controllers: [ProjectController, TaskController],
  providers: [ProjectService],
})
export class ProjectModule {}
