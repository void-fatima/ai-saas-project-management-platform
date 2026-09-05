import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';

import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest, HttpResponse } from './auth.types.js';
import { InvalidSessionError } from './invalid-session.error.js';
import { SessionCookieService } from './session-cookie.service.js';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SessionCookieService) private readonly cookies: SessionCookieService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<HttpResponse>();
    const rawToken = this.cookies.read(request.headers.cookie);

    if (!rawToken) {
      throw new UnauthorizedException('Authentication is required.');
    }

    try {
      const session = await this.auth.authenticate(rawToken);
      request.auth = {
        sessionId: session.sessionId,
        user: session.user,
        userId: session.user.id,
      };
      if (session.rotatedToken) {
        this.cookies.write(response, session.rotatedToken, this.auth.sessionMaxAgeSeconds);
      }
      return true;
    } catch (error: unknown) {
      // An older response must never erase a cookie installed by another request.
      // Only explicit logout clears cookies; operational failures preserve them too.
      if (error instanceof InvalidSessionError) {
        throw new UnauthorizedException('Authentication is required.');
      }
      throw new InternalServerErrorException('Unable to authenticate right now.');
    }
  }
}
