import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AuthService } from './auth.service.js';
import {
  loginSchema,
  registerSchema,
  type LoginInput,
  type RegisterInput,
} from './auth.schemas.js';
import type { AuthContext, AuthenticatedRequest, HttpResponse, PublicUser } from './auth.types.js';
import { SessionAuthGuard } from './session-auth.guard.js';
import { SessionCookieService } from './session-cookie.service.js';

interface AuthResponse {
  user: PublicUser;
}

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SessionCookieService) private readonly cookies: SessionCookieService,
  ) {}

  @Post('register')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async register(
    @Body(new ZodValidationPipe(registerSchema)) input: RegisterInput,
    @Res({ passthrough: true }) response: HttpResponse,
  ): Promise<AuthResponse> {
    const result = await this.auth.register(input);
    this.cookies.write(response, result.token, result.maxAgeSeconds);
    return { user: result.user };
  }

  @Post('login')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) input: LoginInput,
    @Res({ passthrough: true }) response: HttpResponse,
  ): Promise<AuthResponse> {
    const result = await this.auth.login(input);
    this.cookies.write(response, result.token, result.maxAgeSeconds);
    return { user: result.user };
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionAuthGuard)
  me(@Req() request: AuthenticatedRequest): AuthResponse {
    return { user: this.contextFrom(request).user };
  }

  @Post('logout')
  @Header('Cache-Control', 'no-store')
  @HttpCode(204)
  @UseGuards(SessionAuthGuard)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: HttpResponse,
  ): Promise<void> {
    const context = this.contextFrom(request);
    await this.auth.revokeSession(context.sessionId, context.userId);
    this.cookies.clear(response);
  }

  @Post('logout-all')
  @Header('Cache-Control', 'no-store')
  @HttpCode(204)
  @UseGuards(SessionAuthGuard)
  async logoutAll(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: HttpResponse,
  ): Promise<void> {
    await this.auth.revokeAllSessions(this.contextFrom(request).userId);
    this.cookies.clear(response);
  }

  private contextFrom(request: AuthenticatedRequest): AuthContext {
    if (!request.auth) throw new UnauthorizedException('Authentication is required.');
    return request.auth;
  }
}
