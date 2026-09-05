import { randomUUID } from 'node:crypto';

import type {
  AuthRepository,
  NewSession,
  NewUser,
  RotatedSession,
} from '../../src/auth/auth.repository.js';
import type { ActiveSessionRecord, UserRecord } from '../../src/auth/auth.types.js';

interface StoredSession {
  expiresAt: Date;
  id: string;
  previousTokenExpiresAt: Date | null;
  previousTokenHash: string | null;
  revokedAt: Date | null;
  rotatedAt: Date;
  tokenHash: string;
  userId: string;
}

export class MemoryAuthRepository implements AuthRepository {
  private readonly sessions = new Map<string, StoredSession>();
  private readonly users = new Map<string, UserRecord>();

  reset(): void {
    this.sessions.clear();
    this.users.clear();
  }

  async createUserWithSession(
    input: NewUser,
    session: NewSession,
    now: Date,
  ): Promise<{ sessionId: string; user: UserRecord } | null> {
    if ([...this.users.values()].some((user) => user.email === input.email)) return null;

    const user: UserRecord = {
      ...input,
      createdAt: now,
      emailVerifiedAt: null,
      id: randomUUID(),
    };
    this.users.set(user.id, user);
    const sessionId = await this.createSession(user.id, session, now);
    return { sessionId, user };
  }

  createSession(userId: string, session: NewSession, now: Date): Promise<string> {
    const id = randomUUID();
    this.sessions.set(id, {
      ...session,
      id,
      previousTokenExpiresAt: null,
      previousTokenHash: null,
      revokedAt: null,
      rotatedAt: now,
      userId,
    });
    return Promise.resolve(id);
  }

  findUserByEmail(email: string): Promise<UserRecord | null> {
    return Promise.resolve([...this.users.values()].find((user) => user.email === email) ?? null);
  }

  findActiveSession(tokenHash: string, now: Date): Promise<ActiveSessionRecord | null> {
    const session = [...this.sessions.values()].find(
      (candidate) =>
        (candidate.tokenHash === tokenHash ||
          (candidate.previousTokenHash === tokenHash &&
            candidate.previousTokenExpiresAt !== null &&
            candidate.previousTokenExpiresAt > now)) &&
        candidate.revokedAt === null &&
        candidate.expiresAt > now,
    );
    if (!session) return Promise.resolve(null);

    const user = this.users.get(session.userId);
    if (!user) return Promise.resolve(null);
    return Promise.resolve({
      expiresAt: session.expiresAt,
      id: session.id,
      rotatedAt: session.rotatedAt,
      tokenHash: session.tokenHash,
      user,
    });
  }

  rotateSession(
    sessionId: string,
    currentTokenHash: string,
    nextSession: RotatedSession,
    now: Date,
  ): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (
      !session ||
      session.tokenHash !== currentTokenHash ||
      session.revokedAt !== null ||
      session.expiresAt <= now
    ) {
      return Promise.resolve(false);
    }
    Object.assign(session, nextSession, { previousTokenHash: currentTokenHash, rotatedAt: now });
    return Promise.resolve(true);
  }

  revokeSession(sessionId: string, userId: string, now: Date): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session?.userId === userId && session.revokedAt === null) session.revokedAt = now;
    return Promise.resolve();
  }

  revokeAllSessions(userId: string, now: Date): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.revokedAt === null) session.revokedAt = now;
    }
    return Promise.resolve();
  }
}
