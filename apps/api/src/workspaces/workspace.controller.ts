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
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { tokenInputSchema, type TokenInput } from '../auth/auth.schemas.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { WorkspaceService } from './workspace.service.js';
import { WorkspaceInvitationService } from './workspace-invitation.service.js';
import {
  invitationInput,
  roleInput,
  workspaceInput,
  type InvitationInput,
  type RoleInput,
  type WorkspaceInput,
} from './workspace.schemas.js';

function actor(request: AuthenticatedRequest): string {
  if (!request.auth) throw new UnauthorizedException('Authentication is required.');
  return request.auth.userId;
}

@Controller('workspaces')
@UseGuards(SessionAuthGuard)
export class WorkspaceController {
  constructor(
    @Inject(WorkspaceService) private readonly workspaces: WorkspaceService,
    @Inject(WorkspaceInvitationService) private readonly invitations: WorkspaceInvitationService,
  ) {}
  @Get()
  async list(@Req() request: AuthenticatedRequest) {
    return { workspaces: await this.workspaces.list(actor(request)) };
  }
  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(workspaceInput)) input: WorkspaceInput,
  ) {
    return this.workspaces.create(actor(request), input.name);
  }
  @Post('invitations/accept')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  accept(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(tokenInputSchema)) input: TokenInput,
  ) {
    return this.invitations.accept(actor(request), input.token);
  }
  @Get(':workspaceId')
  detail(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe()) id: string,
  ) {
    return this.workspaces.detail(id, actor(request));
  }
  @Patch(':workspaceId')
  rename(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(workspaceInput)) input: WorkspaceInput,
  ) {
    return this.workspaces.rename(id, actor(request), input.name);
  }
  @Delete(':workspaceId')
  @HttpCode(204)
  delete(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe()) id: string,
  ) {
    return this.workspaces.delete(id, actor(request));
  }
  @Post(':workspaceId/leave')
  @HttpCode(204)
  leave(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe()) id: string,
  ) {
    return this.workspaces.leave(id, actor(request));
  }
  @Patch(':workspaceId/members/:userId')
  @HttpCode(204)
  changeRole(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body(new ZodValidationPipe(roleInput)) input: RoleInput,
  ) {
    return this.workspaces.changeMember(id, actor(request), userId, input.role);
  }
  @Delete(':workspaceId/members/:userId')
  @HttpCode(204)
  remove(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ) {
    return this.workspaces.changeMember(id, actor(request), userId);
  }
  @Post(':workspaceId/invitations')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  invite(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(invitationInput)) input: InvitationInput,
  ) {
    return this.invitations.invite(id, actor(request), input.email, input.role);
  }
  @Delete(':workspaceId/invitations/:invitationId')
  @HttpCode(204)
  revoke(
    @Req() request: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe()) id: string,
    @Param('invitationId', new ParseUUIDPipe()) invitationId: string,
  ) {
    return this.invitations.revoke(id, actor(request), invitationId);
  }
}
