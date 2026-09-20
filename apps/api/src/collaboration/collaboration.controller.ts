import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { pageInput } from '../projects/project.schemas.js';
import { CollaborationService } from './collaboration.service.js';
import { NotificationService } from './notification.service.js';
import {
  activityQuery,
  commentInput,
  commentParams,
  commentUpdate,
  commentVersion,
  type CommentParams,
} from './collaboration.schemas.js';

function actor(req: AuthenticatedRequest) {
  if (!req.auth) throw new UnauthorizedException('Authentication is required.');
  return req.auth.userId;
}

@Controller([
  'workspaces/:workspaceId/projects/:projectId/tasks/:taskId/comments',
  'workspaces/:workspaceId/projects/:projectId/tasks/:parentId/subtasks/:taskId/comments',
])
@UseGuards(SessionAuthGuard)
export class CommentController {
  constructor(@Inject(CollaborationService) private readonly service: CollaborationService) {}
  @Get()
  list(
    @Req() req: AuthenticatedRequest,
    @Param(new ZodValidationPipe(commentParams)) p: CommentParams,
    @Query(new ZodValidationPipe(pageInput)) q: z.infer<typeof pageInput>,
  ) {
    return this.service.list(p, actor(req), q.offset);
  }
  @Post()
  create(
    @Req() req: AuthenticatedRequest,
    @Param(new ZodValidationPipe(commentParams)) p: CommentParams,
    @Body(new ZodValidationPipe(commentInput)) body: z.infer<typeof commentInput>,
  ) {
    return this.service.create(p, actor(req), body);
  }
  @Patch(':commentId')
  update(
    @Req() req: AuthenticatedRequest,
    @Param(new ZodValidationPipe(commentParams.required({ commentId: true })))
    p: CommentParams & { commentId: string },
    @Body(new ZodValidationPipe(commentUpdate)) body: z.infer<typeof commentUpdate>,
  ) {
    return this.service.change(p, actor(req), body);
  }
  @Delete(':commentId')
  @HttpCode(204)
  async delete(
    @Req() req: AuthenticatedRequest,
    @Param(new ZodValidationPipe(commentParams.required({ commentId: true })))
    p: CommentParams & { commentId: string },
    @Body(new ZodValidationPipe(commentVersion)) body: z.infer<typeof commentVersion>,
  ) {
    await this.service.change(p, actor(req), body);
  }
}

@Controller('workspaces/:workspaceId/activity')
@UseGuards(SessionAuthGuard)
export class ActivityController {
  constructor(@Inject(CollaborationService) private readonly service: CollaborationService) {}
  @Get()
  list(
    @Req() req: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe()) w: string,
    @Query(new ZodValidationPipe(activityQuery)) q: z.infer<typeof activityQuery>,
  ) {
    return this.service.activity(w, actor(req), q);
  }
}

@Controller('notifications')
@UseGuards(SessionAuthGuard)
export class NotificationController {
  constructor(@Inject(NotificationService) private readonly service: NotificationService) {}
  @Get()
  list(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(pageInput)) q: z.infer<typeof pageInput>,
  ) {
    return this.service.list(actor(req), q.offset);
  }
  @Patch(':notificationId/read')
  @HttpCode(204)
  read(@Req() req: AuthenticatedRequest, @Param('notificationId', new ParseUUIDPipe()) id: string) {
    return this.service.read(actor(req), id);
  }
  @Post('read-all')
  @HttpCode(204)
  readAll(@Req() req: AuthenticatedRequest) {
    return this.service.readAll(actor(req));
  }
}
