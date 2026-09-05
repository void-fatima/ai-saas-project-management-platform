import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';

import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaAuthRepository } from '../src/auth/prisma-auth.repository.js';
import { SessionTokenService } from '../src/auth/session-token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

describe('PostgreSQL session lifecycle', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repository: PrismaAuthRepository;
  let fixtureUserId: string | undefined;
  const tokens = new SessionTokenService();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    repository = app.get(PrismaAuthRepository);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    // Delete only this test's unique account; its sessions cascade. Never reset the database.
    if (fixtureUserId) {
      await prisma.user.delete({ where: { id: fixtureUserId } });
      fixtureUserId = undefined;
    }
  });

  afterAll(async () => app?.close());

  async function fixture() {
    const now = new Date();
    const token = tokens.issue();
    const expiresAt = new Date(now.getTime() + 60_000);
    const created = await repository.createUserWithSession(
      {
        email: `session-test-${randomUUID()}@example.com`,
        name: 'Session Test',
        passwordHash: 'unused',
      },
      { expiresAt, tokenHash: token.hash },
      now,
    );
    if (!created) throw new Error('Unique integration fixture could not be created.');
    fixtureUserId = created.user.id;
    return { ...created, expiresAt, now, token };
  }

  it('creates a hashed session and rejects it exactly at expiry', async () => {
    const session = await fixture();
    const stored = await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(stored.tokenHash).toBe(session.token.hash);
    expect(stored.tokenHash).not.toBe(session.token.raw);
    expect(stored.previousTokenHash).toBeNull();
    expect(await repository.findActiveSession(session.token.hash, session.now)).toMatchObject({
      id: session.sessionId,
      user: { id: session.user.id },
    });
    expect(await repository.findActiveSession(session.token.hash, session.expiresAt)).toBeNull();
  });

  it('permits exactly one concurrent CAS, retains one row, and expires the predecessor', async () => {
    const session = await fixture();
    const replacements = [tokens.issue(), tokens.issue()];
    const graceEnd = new Date(session.now.getTime() + 30_000);
    const outcomes = await Promise.all(
      replacements.map((token) =>
        repository.rotateSession(
          session.sessionId,
          session.token.hash,
          { expiresAt: session.expiresAt, previousTokenExpiresAt: graceEnd, tokenHash: token.hash },
          session.now,
        ),
      ),
    );
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect(await prisma.session.count({ where: { userId: session.user.id } })).toBe(1);
    const winner = replacements[outcomes.findIndex(Boolean)]!;
    const loser = replacements[outcomes.findIndex((success) => !success)]!;
    expect(await repository.findActiveSession(winner.hash, session.now)).toMatchObject({
      id: session.sessionId,
    });
    expect(await repository.findActiveSession(loser.hash, session.now)).toBeNull();
    expect(await repository.findActiveSession(session.token.hash, session.now)).toMatchObject({
      id: session.sessionId,
      tokenHash: winner.hash,
    });
    expect(await repository.findActiveSession(session.token.hash, graceEnd)).toBeNull();
    expect(await repository.findActiveSession(winner.hash, graceEnd)).not.toBeNull();
  });

  it.each(['expired', 'revoked'] as const)(
    'refuses a conditional rotation of a %s row',
    async (state) => {
      const session = await fixture();
      if (state === 'revoked')
        await repository.revokeSession(session.sessionId, session.user.id, session.now);
      const checkTime = state === 'expired' ? session.expiresAt : session.now;
      const replacement = tokens.issue();
      expect(
        await repository.rotateSession(
          session.sessionId,
          session.token.hash,
          {
            expiresAt: new Date(checkTime.getTime() + 60_000),
            previousTokenExpiresAt: new Date(checkTime.getTime() + 30_000),
            tokenHash: replacement.hash,
          },
          checkTime,
        ),
      ).toBe(false);
      expect(await repository.findActiveSession(session.token.hash, checkTime)).toBeNull();
      expect(await repository.findActiveSession(replacement.hash, checkTime)).toBeNull();
      const stored = await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } });
      expect(stored.tokenHash).toBe(session.token.hash);
    },
  );

  it('authenticates both overlapping requests after a real PostgreSQL rotation conflict', async () => {
    const session = await fixture();
    await prisma.session.update({
      where: { id: session.sessionId },
      data: { rotatedAt: new Date(session.now.getTime() - 8 * 24 * 3_600_000) },
    });
    const originalRotate = repository.rotateSession.bind(repository);
    let arrivals = 0;
    let release: () => void = () => {
      throw new Error('Barrier not initialized.');
    };
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const outcomes: boolean[] = [];
    // Only coordinate arrival: both reads, conditional writes, and the losing
    // request's recheck still execute through the production repository in PostgreSQL.
    vi.spyOn(repository, 'rotateSession').mockImplementation(async (...args) => {
      arrivals += 1;
      if (arrivals === 2) release();
      await gate;
      const rotated = await originalRotate(...args);
      outcomes.push(rotated);
      return rotated;
    });
    const auth = app.get(AuthService);
    const results = await Promise.all([
      auth.authenticate(session.token.raw),
      auth.authenticate(session.token.raw),
    ]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect(results.filter((result) => result.rotatedToken !== undefined)).toHaveLength(1);
    for (const result of results) {
      expect(result).toMatchObject({ sessionId: session.sessionId, user: { id: session.user.id } });
    }
    expect(await prisma.session.count({ where: { userId: session.user.id } })).toBe(1);
  });

  it.each(['one', 'all'] as const)(
    'revokes %s session scope after rotation, including predecessor credentials',
    async (scope) => {
      const session = await fixture();
      const other = tokens.issue();
      await repository.createSession(
        session.user.id,
        { expiresAt: session.expiresAt, tokenHash: other.hash },
        session.now,
      );
      const replacement = tokens.issue();
      expect(
        await repository.rotateSession(
          session.sessionId,
          session.token.hash,
          {
            expiresAt: session.expiresAt,
            previousTokenExpiresAt: new Date(session.now.getTime() + 30_000),
            tokenHash: replacement.hash,
          },
          session.now,
        ),
      ).toBe(true);
      if (scope === 'one') {
        await repository.revokeSession(session.sessionId, session.user.id, session.now);
      } else {
        await repository.revokeAllSessions(session.user.id, session.now);
      }
      expect(await repository.findActiveSession(session.token.hash, session.now)).toBeNull();
      expect(await repository.findActiveSession(replacement.hash, session.now)).toBeNull();
      const remaining = await repository.findActiveSession(other.hash, session.now);
      if (scope === 'one') expect(remaining).not.toBeNull();
      else expect(remaining).toBeNull();
    },
  );
});
