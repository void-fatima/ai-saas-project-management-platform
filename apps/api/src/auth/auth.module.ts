import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller.js';
import { AUTH_REPOSITORY } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { PrismaAuthRepository } from './prisma-auth.repository.js';
import { SessionAuthGuard } from './session-auth.guard.js';
import { SessionCookieService } from './session-cookie.service.js';
import { SessionTokenService } from './session-token.service.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    SessionAuthGuard,
    SessionCookieService,
    SessionTokenService,
    PrismaAuthRepository,
    { provide: AUTH_REPOSITORY, useExisting: PrismaAuthRepository },
  ],
})
export class AuthModule {}
