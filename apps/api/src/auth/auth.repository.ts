import type { ActiveSessionRecord, UserRecord } from './auth.types.js';

export const AUTH_REPOSITORY = Symbol('AUTH_REPOSITORY');

export interface NewSession {
  expiresAt: Date;
  tokenHash: string;
}

export interface RotatedSession extends NewSession {
  previousTokenExpiresAt: Date;
}

export interface NewUser {
  email: string;
  name: string;
  passwordHash: string;
}

export interface AuthRepository {
  createSession(userId: string, session: NewSession, now: Date): Promise<string>;
  createUserWithSession(
    user: NewUser,
    session: NewSession,
    now: Date,
  ): Promise<{ sessionId: string; user: UserRecord } | null>;
  findActiveSession(tokenHash: string, now: Date): Promise<ActiveSessionRecord | null>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  revokeAllSessions(userId: string, now: Date): Promise<void>;
  revokeSession(sessionId: string, userId: string, now: Date): Promise<void>;
  rotateSession(
    sessionId: string,
    currentTokenHash: string,
    nextSession: RotatedSession,
    now: Date,
  ): Promise<boolean>;
}
