import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ProjectService } from '../projects/project.service.js';
import { AiService } from './ai.service.js';
import {
  aiParams,
  applyInput,
  generateInput,
  type AiParams,
  type ApplyInput,
} from './ai.schemas.js';
function actor(req: AuthenticatedRequest) {
  if (!req.auth) throw new UnauthorizedException();
  return req.auth.userId;
}

@Controller('workspaces/:workspaceId/projects/:projectId/ai')
@UseGuards(SessionAuthGuard)
export class ProjectAiController {
  constructor(@Inject(AiService) private readonly ai: AiService) {}
  @Post('summary')
  @HttpCode(200)
  summary(
    @Req() req: AuthenticatedRequest,
    @Param(new ZodValidationPipe(aiParams)) p: AiParams,
    @Body(new ZodValidationPipe(generateInput)) body: { requestId: string },
  ) {
    return this.ai.generate(p, actor(req), body.requestId, 'SUMMARY');
  }
}
@Controller([
  'workspaces/:workspaceId/projects/:projectId/tasks/:taskId/ai',
  'workspaces/:workspaceId/projects/:projectId/tasks/:parentId/subtasks/:taskId/ai',
])
@UseGuards(SessionAuthGuard)
export class TaskAiController {
  constructor(
    @Inject(AiService) private readonly ai: AiService,
    @Inject(ProjectService) private readonly projects: ProjectService,
  ) {}
  @Post('breakdown')
  @HttpCode(200)
  breakdown(
    @Req() req: AuthenticatedRequest,
    @Param(new ZodValidationPipe(aiParams.required({ taskId: true }))) p: AiParams,
    @Body(new ZodValidationPipe(generateInput)) body: { requestId: string },
  ) {
    return this.ai.generate(p, actor(req), body.requestId, 'BREAKDOWN');
  }
  @Post('plan')
  @HttpCode(200)
  plan(
    @Req() req: AuthenticatedRequest,
    @Param(new ZodValidationPipe(aiParams.required({ taskId: true }))) p: AiParams,
    @Body(new ZodValidationPipe(generateInput)) body: { requestId: string },
  ) {
    return this.ai.generate(p, actor(req), body.requestId, 'PLAN');
  }
  @Post('breakdown/apply')
  @HttpCode(200)
  apply(
    @Req() req: AuthenticatedRequest,
    @Param(new ZodValidationPipe(aiParams.required({ taskId: true }))) p: AiParams,
    @Body(new ZodValidationPipe(applyInput)) body: ApplyInput,
  ) {
    return this.projects.applyBreakdown(p, actor(req), body);
  }
}
