import { Module } from '@nestjs/common';
import { AccountRecoveryController } from './account-recovery.controller.js';
import { AccountRecoveryService } from './account-recovery.service.js';
import {
  AccountTokenRepository,
  PrismaAccountTokenRepository,
} from './account-token.repository.js';
import { AccountMailDelivery, DevelopmentAccountMail } from './account-mail.service.js';

import { AuthController } from './auth.controller.js';
import { AUTH_REPOSITORY } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { PrismaAuthRepository } from './prisma-auth.repository.js';
import { SessionAuthGuard } from './session-auth.guard.js';
import { SessionCookieService } from './session-cookie.service.js';
import { SessionTokenService } from './session-token.service.js';

@Module({
  controllers: [AuthController, AccountRecoveryController],
  providers: [
    AccountRecoveryService,
    { provide: AccountTokenRepository, useClass: PrismaAccountTokenRepository },
    { provide: AccountMailDelivery, useClass: DevelopmentAccountMail },
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
