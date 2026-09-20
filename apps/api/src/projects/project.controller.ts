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
import { ProjectService } from './project.service.js';
import {
  pageInput,
  projectInput,
  projectUpdate,
  taskInput,
  taskUpdate,
  moveInput,
  taskListInput,
  type ProjectInput,
  type ProjectUpdate,
  type TaskInput,
  type TaskUpdate,
  type MoveInput,
} from './project.schemas.js';

function actor(request: AuthenticatedRequest) {
  if (!request.auth) throw new UnauthorizedException('Authentication is required.');
  return request.auth.userId;
}
const projectParams = z.object({ workspaceId: z.uuid(), projectId: z.uuid() }).strict();
const taskParams = projectParams.extend({
  parentId: z.uuid().optional(),
  taskId: z.uuid().optional(),
});
type ProjectParams = z.infer<typeof projectParams>;
type TaskParams = z.infer<typeof taskParams>;

@Controller('workspaces/:workspaceId/projects')
@UseGuards(SessionAuthGuard)
export class ProjectController {
  constructor(@Inject(ProjectService) private readonly service: ProjectService) {}
  @Get()
  list(
    @Req() req: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe()) w: string,
    @Query(new ZodValidationPipe(pageInput)) q: z.infer<typeof pageInput>,
  ) {
    return this.service.list(w, actor(req), q.offset);
  }
  @Get('assignees')
  members(
    @Req() req: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe()) w: string,
    @Query(new ZodValidationPipe(pageInput)) q: z.infer<typeof pageInput>,
  ) {
    return this.service.members(w, actor(req), q.offset);
  }
  @Post()
  create(
    @Req() req: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe()) w: string,
    @Body(new ZodValidationPipe(projectInput)) input: ProjectInput,
  ) {
    return this.service.create(w, actor(req), input);
  }
  @Get(':projectId')
  detail(
    @Req() req: AuthenticatedRequest,
    @Param(new ZodValidationPipe(projectParams)) p: ProjectParams,
  ) {
    return this.service.detail(p.workspaceId, actor(req), p.projectId);
  }
  @Patch(':projectId')
  update(
    @Req() req: AuthenticatedRequest,
    @Param(new ZodValidationPipe(projectParams)) p: ProjectParams,
    @Body(new ZodValidationPipe(projectUpdate)) input: ProjectUpdate,
  ) {
    return this.service.update(p.workspaceId, actor(req), p.projectId, input);
  }
  @Delete(':projectId')
  @HttpCode(204)
  delete(
    @Req() req: AuthenticatedRequest,
    @Param(new ZodValidationPipe(projectParams)) p: ProjectParams,
  ) {
    return this.service.delete(p.workspaceId, actor(req), p.projectId);
  }
}

@Controller([
  'workspaces/:workspaceId/projects/:projectId/tasks',
  'workspaces/:workspaceId/projects/:projectId/tasks/:parentId/subtasks',
])
@UseGuards(SessionAuthGuard)
export class TaskController {
  constructor(@Inject(ProjectService) private readonly service: ProjectService) {}
  @Get()
  list(
    @Req() req: AuthenticatedRequest,
    @Param(new ZodValidationPipe(taskParams)) p: TaskParams,
    @Query(new ZodValidationPipe(taskListInput)) q: z.infer<typeof taskListInput>,
  ) {
    return this.service.tasks(
      p.workspaceId,
      actor(req),
      p.projectId,
      p.parentId ?? null,
      q.offset,
      q.status,
    );
  }
  @Post()
  create(
    @Req() req: AuthenticatedRequest,
    @Param(new ZodValidationPipe(taskParams)) p: TaskParams,
    @Body(new ZodValidationPipe(taskInput)) input: TaskInput,
  ) {
    return this.service.createTask(
      p.workspaceId,
      actor(req),
      p.projectId,
      p.parentId ?? null,
      input,
    );
  }
  @Get(':taskId')
  detail(
    @Req() req: AuthenticatedRequest,
    @Param(new ZodValidationPipe(taskParams.required({ taskId: true })))
    p: TaskParams & { taskId: string },
  ) {
    return this.service.task(p.workspaceId, actor(req), p.projectId, p.taskId, p.parentId ?? null);
  }
  @Patch(':taskId')
  update(
    @Req() req: AuthenticatedRequest,
    @Param(new ZodValidationPipe(taskParams.required({ taskId: true })))
    p: TaskParams & { taskId: string },
    @Body(new ZodValidationPipe(taskUpdate)) input: TaskUpdate,
  ) {
    return this.service.updateTask(
      p.workspaceId,
      actor(req),
      p.projectId,
      p.taskId,
      p.parentId ?? null,
      input,
    );
  }
  @Post(':taskId/move')
  @HttpCode(200)
  move(
    @Req() req: AuthenticatedRequest,
    @Param(new ZodValidationPipe(taskParams.required({ taskId: true })))
    p: TaskParams & { taskId: string },
    @Body(new ZodValidationPipe(moveInput)) input: MoveInput,
  ) {
    return this.service.move(
      p.workspaceId,
      actor(req),
      p.projectId,
      p.taskId,
      p.parentId ?? null,
      input,
    );
  }
  @Delete(':taskId')
  @HttpCode(204)
  delete(
    @Req() req: AuthenticatedRequest,
    @Param(new ZodValidationPipe(taskParams.required({ taskId: true })))
    p: TaskParams & { taskId: string },
  ) {
    return this.service.deleteTask(
      p.workspaceId,
      actor(req),
      p.projectId,
      p.taskId,
      p.parentId ?? null,
    );
  }
}
