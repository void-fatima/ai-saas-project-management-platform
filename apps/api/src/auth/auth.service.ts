import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Environment } from '../config/environment.validation.js';
import { AUTH_REPOSITORY, type AuthRepository } from './auth.repository.js';
import type { LoginInput, RegisterInput } from './auth.schemas.js';
import type { PublicUser, UserRecord } from './auth.types.js';
import { InvalidSessionError } from './invalid-session.error.js';
import { PasswordService } from './password.service.js';
import { SessionTokenService } from './session-token.service.js';

interface IssuedSession {
  maxAgeSeconds: number;
  sessionId: string;
  token: string;
  user: PublicUser;
}

export interface AuthenticatedSession {
  rotatedToken?: string;
  sessionId: string;
  user: PublicUser;
}

@Injectable()
export class AuthService {
  private readonly rotationMilliseconds: number;
  private readonly sessionMilliseconds: number;
  readonly sessionMaxAgeSeconds: number;

  constructor(
    @Inject(AUTH_REPOSITORY) private readonly repository: AuthRepository,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(SessionTokenService) private readonly sessionTokens: SessionTokenService,
    @Inject(ConfigService) config: ConfigService<Environment, true>,
  ) {
    const sessionHours = config.get('SESSION_TTL_HOURS', { infer: true });
    const rotationHours = config.get('SESSION_ROTATION_HOURS', { infer: true });
    this.sessionMilliseconds = sessionHours * 60 * 60 * 1000;
    this.rotationMilliseconds = rotationHours * 60 * 60 * 1000;
    this.sessionMaxAgeSeconds = sessionHours * 60 * 60;
  }

  async register(input: RegisterInput): Promise<IssuedSession> {
    const now = new Date();
    const passwordHash = await this.passwords.hash(input.password);
    const token = this.sessionTokens.issue();
    const created = await this.repository.createUserWithSession(
      { email: input.email, name: input.name, passwordHash },
      { expiresAt: this.expirationFrom(now), tokenHash: token.hash },
      now,
    );

    if (!created) {
      throw new ConflictException('Unable to create an account with these details.');
    }

    return {
      maxAgeSeconds: this.sessionMaxAgeSeconds,
      sessionId: created.sessionId,
      token: token.raw,
      user: this.toPublicUser(created.user),
    };
  }

  async login(input: LoginInput): Promise<IssuedSession> {
    const user = await this.repository.findUserByEmail(input.email);
    const validPassword = await this.passwords.verifyOrDummy(user?.passwordHash, input.password);

    if (!user || !validPassword) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const now = new Date();
    const token = this.sessionTokens.issue();
    const sessionId = await this.repository.createSession(
      user.id,
      { expiresAt: this.expirationFrom(now), tokenHash: token.hash },
      now,
    );

    return {
      maxAgeSeconds: this.sessionMaxAgeSeconds,
      sessionId,
      token: token.raw,
      user: this.toPublicUser(user),
    };
  }

  async authenticate(rawToken: string): Promise<AuthenticatedSession> {
    if (!this.sessionTokens.isValid(rawToken)) throw new InvalidSessionError();

    const now = new Date();
    const currentTokenHash = this.sessionTokens.hash(rawToken);
    const session = await this.repository.findActiveSession(currentTokenHash, now);

    if (!session) {
      throw new InvalidSessionError();
    }

    const result: AuthenticatedSession = {
      sessionId: session.id,
      user: this.toPublicUser(session.user),
    };

    // A predecessor token may finish an overlapping request but cannot rotate again.
    if (
      session.tokenHash === currentTokenHash &&
      now.getTime() - session.rotatedAt.getTime() >= this.rotationMilliseconds
    ) {
      const nextToken = this.sessionTokens.issue();
      const rotated = await this.repository.rotateSession(
        session.id,
        currentTokenHash,
        {
          expiresAt: this.expirationFrom(now),
          previousTokenExpiresAt: new Date(
            Math.min(session.expiresAt.getTime(), now.getTime() + 30_000),
          ),
          tokenHash: nextToken.hash,
        },
        now,
      );
      if (rotated) {
        result.rotatedToken = nextToken.raw;
      } else {
        // A failed CAS can also mean revocation or expiry. Never trust the old snapshot.
        const current = await this.repository.findActiveSession(currentTokenHash, new Date());
        if (!current || current.id !== session.id) throw new InvalidSessionError();
        if (current.tokenHash === currentTokenHash) {
          throw new Error('Session rotation did not advance.');
        }
        return { sessionId: current.id, user: this.toPublicUser(current.user) };
      }
    }

    return result;
  }

  revokeSession(sessionId: string, userId: string): Promise<void> {
    return this.repository.revokeSession(sessionId, userId, new Date());
  }

  revokeAllSessions(userId: string): Promise<void> {
    return this.repository.revokeAllSessions(userId, new Date());
  }

  private expirationFrom(now: Date): Date {
    return new Date(now.getTime() + this.sessionMilliseconds);
  }

  private toPublicUser(user: UserRecord): PublicUser {
    return {
      createdAt: user.createdAt.toISOString(),
      email: user.email,
      emailVerified: user.emailVerifiedAt !== null,
      id: user.id,
      name: user.name,
    };
  }
}
