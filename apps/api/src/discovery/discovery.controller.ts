import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DiscoveryService } from './discovery.service.js';
import { searchInput, type SearchInput } from './discovery.schemas.js';

function actor(request: AuthenticatedRequest) {
  if (!request.auth) throw new UnauthorizedException('Authentication is required.');
  return request.auth.userId;
}
@Controller('workspaces/:workspaceId')
@UseGuards(SessionAuthGuard)
export class DiscoveryController {
  constructor(@Inject(DiscoveryService) private readonly service: DiscoveryService) {}
  @Get('dashboard')
  dashboard(
    @Req() req: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(z.object({}).strict())) query: Record<string, never>,
  ) {
    void query; // The pipe rejects unsupported query parameters before any database read.
    return this.service.dashboard(id, actor(req));
  }
  @Get('search')
  search(
    @Req() req: AuthenticatedRequest,
    @Param('workspaceId', new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(searchInput)) query: SearchInput,
  ) {
    return this.service.search(id, actor(req), query);
  }
}
