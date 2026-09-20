import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { WorkspaceModule } from '../workspaces/workspace.module.js';
import {
  ActivityController,
  CommentController,
  NotificationController,
} from './collaboration.controller.js';
import { CollaborationService } from './collaboration.service.js';
import { NotificationService } from './notification.service.js';
import { RealtimeService } from './realtime.service.js';
import { RealtimeController } from './realtime.controller.js';

@Module({
  imports: [AuthModule, WorkspaceModule],
  controllers: [ActivityController, CommentController, NotificationController, RealtimeController],
  providers: [CollaborationService, NotificationService, RealtimeService],
})
export class CollaborationModule {}
