import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.validation.js';
import { AUTH_REPOSITORY, type AuthRepository } from './auth.repository.js';
import { AccountTokenRepository, type AccountTokenKind } from './account-token.repository.js';
import { AccountMailDelivery } from './account-mail.service.js';
import { PasswordService } from './password.service.js';
import { SessionTokenService } from './session-token.service.js';

@Injectable()
export class AccountRecoveryService {
  constructor(
    @Inject(AUTH_REPOSITORY) private readonly users: AuthRepository,
    @Inject(AccountTokenRepository) private readonly repository: AccountTokenRepository,
    @Inject(AccountMailDelivery) private readonly delivery: AccountMailDelivery,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(SessionTokenService) private readonly tokens: SessionTokenService,
    @Inject(ConfigService) private readonly config: ConfigService<Environment, true>,
  ) {}

  async request(email: string, kind: AccountTokenKind): Promise<void> {
    // Fail equally for known and unknown accounts when transport is unavailable.
    this.delivery.assertAvailable();
    const user = await this.users.findUserByEmail(email);
    if (!user || (kind === 'VERIFY_EMAIL' && user.emailVerifiedAt)) return;
    const token = this.tokens.issue();
    const now = new Date();
    const expiry = new Date(
      now.getTime() + (kind === 'VERIFY_EMAIL' ? 24 * 3_600_000 : 30 * 60_000),
    );
    if (!(await this.repository.issue(user.id, kind, token.hash, now, expiry))) return;
    const purpose = kind === 'VERIFY_EMAIL' ? 'verify' : 'reset';
    try {
      await this.delivery.send({
        to: user.email,
        purpose,
        url: `${this.config.get('WEB_ORIGIN', { infer: true })}/#${purpose}=${token.raw}`,
      });
    } catch {
      await this.repository.invalidate(token.hash);
      throw new ServiceUnavailableException('Account email delivery is unavailable.');
    }
  }

  async consume(raw: string, kind: AccountTokenKind, password?: string): Promise<void> {
    if (!this.tokens.isValid(raw))
      throw new BadRequestException('This link is invalid, expired, or already used.');
    const passwordHash =
      kind === 'RESET_PASSWORD' && password ? await this.passwords.hash(password) : undefined;
    if (!(await this.repository.consume(this.tokens.hash(raw), kind, new Date(), passwordHash))) {
      throw new BadRequestException('This link is invalid, expired, or already used.');
    }
  }
}
