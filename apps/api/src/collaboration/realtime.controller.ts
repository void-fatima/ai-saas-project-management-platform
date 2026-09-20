import {
  Controller,
  Get,
  Inject,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { RealtimeService } from './realtime.service.js';

@Controller('realtime')
@UseGuards(SessionAuthGuard)
export class RealtimeController {
  constructor(@Inject(RealtimeService) private readonly service: RealtimeService) {}
  @Get()
  connect(@Req() req: AuthenticatedRequest, @Res() res: ServerResponse) {
    if (!req.auth) throw new UnauthorizedException('Authentication is required.');
    return this.service.connect(req.auth, res);
  }
}
