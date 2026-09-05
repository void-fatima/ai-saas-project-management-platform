import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { AUTH_REPOSITORY } from '../src/auth/auth.repository.js';
import { SessionTokenService } from '../src/auth/session-token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { MemoryAuthRepository } from './support/memory-auth.repository.js';

const now = new Date('2030-01-01T00:00:00.000Z');
const tokens = new SessionTokenService();

describe('Session lifecycle HTTP regressions', () => {
  let app: INestApplication<Server>;
  let server: Server;
  let repository: MemoryAuthRepository;

  beforeAll(async () => {
    repository = new MemoryAuthRepository();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $connect: vi.fn(), $disconnect: vi.fn() })
      .overrideProvider(AUTH_REPOSITORY)
      .useValue(repository)
      .compile();
    app = moduleRef.createNestApplication<INestApplication<Server>>();
    await app.init();
    server = app.getHttpServer();
  });

  beforeEach(() => {
    repository.reset();
    // Keep HTTP timers real while controlling session expiry precisely.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  afterAll(async () => app?.close());

  async function fixture(options: { expiresAt?: Date; rotationDue?: boolean } = {}) {
    const token = tokens.issue();
    const created = await repository.createUserWithSession(
      {
        email: 'session@example.com',
        name: 'Session Owner',
        passwordHash: 'unused-in-session-tests',
      },
      {
        expiresAt: options.expiresAt ?? new Date(now.getTime() + 3_600_000),
        tokenHash: token.hash,
      },
      options.rotationDue ? new Date(now.getTime() - 8 * 24 * 3_600_000) : now,
    );
    if (!created) throw new Error('Session fixture creation failed.');
    return { ...created, cookie: `platform_session=${token.raw}`, token };
  }

  function me(cookie: string) {
    return request(server).get('/auth/me').set('Cookie', cookie);
  }

  it('rejects a missing cookie without changing browser cookies', async () => {
    const response = await request(server).get('/auth/me').expect(401);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it.each(['bad-token', 'a'.repeat(44), '%00'])(
    'rejects malformed token %s before lookup',
    async (raw) => {
      const lookup = vi.spyOn(repository, 'findActiveSession');
      const response = await me(`platform_session=${raw}`).expect(401);
      expect(lookup).not.toHaveBeenCalled();
      expect(response.headers['set-cookie']).toBeUndefined();
    },
  );

  it('rejects an unknown well-formed token without clearing a possibly newer cookie', async () => {
    const response = await me(`platform_session=${tokens.issue().raw}`).expect(401);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('authenticates a valid session without unnecessary rotation', async () => {
    const session = await fixture();
    const response = await me(session.cookie).expect(200);
    expect(response.body).toMatchObject({ user: { id: session.user.id } });
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain(session.token.hash);
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
  });

  it('rejects a session exactly at expiry', async () => {
    const session = await fixture({ expiresAt: now, rotationDue: true });
    const rotate = vi.spyOn(repository, 'rotateSession');
    const response = await me(session.cookie).expect(401);
    expect(rotate).not.toHaveBeenCalled();
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('rejects a revoked session instead of rotating it', async () => {
    const session = await fixture({ rotationDue: true });
    await repository.revokeSession(session.sessionId, session.user.id, now);
    const rotate = vi.spyOn(repository, 'rotateSession');
    await me(session.cookie).expect(401);
    expect(rotate).not.toHaveBeenCalled();
  });

  it.each(['lookup', 'rotation', 'conflict recheck'] as const)(
    'returns a safe server failure on %s failure and preserves the cookie for retry',
    async (failure) => {
      const session = await fixture({ rotationDue: failure !== 'lookup' });
      const error = new Error('database connection contains private-internal-details');
      if (failure === 'lookup') {
        vi.spyOn(repository, 'findActiveSession').mockRejectedValueOnce(error);
      } else if (failure === 'rotation') {
        vi.spyOn(repository, 'rotateSession').mockRejectedValueOnce(error);
      } else {
        const snapshot = await repository.findActiveSession(session.token.hash, now);
        vi.spyOn(repository, 'findActiveSession')
          .mockResolvedValueOnce(snapshot)
          .mockRejectedValueOnce(error);
        vi.spyOn(repository, 'rotateSession').mockResolvedValueOnce(false);
      }
      const response = await me(session.cookie).expect(500);
      expect(response.body).toEqual({
        message: 'Unable to authenticate right now.',
        error: 'Internal Server Error',
        statusCode: 500,
      });
      expect(response.headers['set-cookie']).toBeUndefined();
      vi.restoreAllMocks();
      await me(session.cookie).expect(200);
    },
  );

  it('rotates once, accepts the predecessor only during grace, and keeps the same session', async () => {
    const session = await fixture({ rotationDue: true });
    const response = await me(session.cookie).expect(200);
    const cookie = String(response.headers['set-cookie']).split(';')[0]!;
    expect(cookie).not.toBe(session.cookie);
    expect(String(response.headers['set-cookie'])).toContain('HttpOnly');
    expect(String(response.headers['set-cookie'])).toContain('SameSite=Strict');
    const rotated = await repository.findActiveSession(session.token.hash, now);
    expect(rotated?.id).toBe(session.sessionId);
    expect(rotated?.tokenHash).not.toBe(session.token.hash);
    expect(rotated?.tokenHash).toMatch(/^[a-f0-9]{64}$/);

    vi.setSystemTime(now.getTime() + 29_999);
    const overlapping = await me(session.cookie).expect(200);
    expect(overlapping.headers['set-cookie']).toBeUndefined();
    vi.setSystemTime(now.getTime() + 30_000);
    const late = await me(session.cookie).expect(401);
    expect(late.headers['set-cookie']).toBeUndefined();
    await me(cookie).expect(200);
  });

  it('never extends the predecessor beyond its original expiry', async () => {
    const session = await fixture({
      expiresAt: new Date(now.getTime() + 1_000),
      rotationDue: true,
    });
    const response = await me(session.cookie).expect(200);
    const cookie = String(response.headers['set-cookie']).split(';')[0]!;
    vi.setSystemTime(now.getTime() + 1_000);
    await me(session.cookie).expect(401);
    await me(cookie).expect(200);
  });

  it('revalidates a failed CAS when two HTTP requests rotate concurrently; only one sets a cookie', async () => {
    const session = await fixture({ rotationDue: true });
    const originalRotate = repository.rotateSession.bind(repository);
    let arrivals = 0;
    const outcomes: boolean[] = [];
    let release: () => void = () => {
      throw new Error('Barrier not initialized.');
    };
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const rotate = vi.spyOn(repository, 'rotateSession').mockImplementation(async (...args) => {
      arrivals += 1;
      if (arrivals === 2) release();
      await gate;
      const rotated = await originalRotate(...args);
      outcomes.push(rotated);
      return rotated;
    });
    const lookup = vi.spyOn(repository, 'findActiveSession');
    const responses = await Promise.all([
      me(session.cookie).expect(200),
      me(session.cookie).expect(200),
    ]);
    expect(rotate).toHaveBeenCalledTimes(2);
    expect(lookup).toHaveBeenCalledTimes(3);
    expect(outcomes).toEqual([true, false]);
    const replacements = responses.filter(
      (response) => response.headers['set-cookie'] !== undefined,
    );
    expect(replacements).toHaveLength(1);
    const cookie = String(replacements[0]!.headers['set-cookie']).split(';')[0]!;
    await me(cookie).expect(200);
    const overlap = await me(session.cookie).expect(200);
    expect(overlap.headers['set-cookie']).toBeUndefined();
    expect(rotate).toHaveBeenCalledTimes(2);
  });

  it.each(['revocation', 'expiry'] as const)(
    'does not return stale identity after %s defeats rotation',
    async (reason) => {
      const session = await fixture({ rotationDue: true });
      const originalRotate = repository.rotateSession.bind(repository);
      vi.spyOn(repository, 'rotateSession').mockImplementationOnce(async (...args) => {
        if (reason === 'revocation') {
          await repository.revokeSession(session.sessionId, session.user.id, now);
        } else {
          vi.setSystemTime(now.getTime() + 3_600_000);
        }
        return originalRotate(args[0], args[1], args[2], new Date());
      });
      const response = await me(session.cookie).expect(401);
      expect(response.headers['set-cookie']).toBeUndefined();
      await me(session.cookie).expect(401);
    },
  );

  it('fails closed if a failed CAS has no confirmed replacement', async () => {
    const session = await fixture({ rotationDue: true });
    vi.spyOn(repository, 'rotateSession').mockResolvedValueOnce(false);
    const response = await me(session.cookie).expect(500);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('rotation did not advance');
  });

  it.each(['/auth/logout', '/auth/logout-all'])(
    '%s revokes current and predecessor tokens after rotation',
    async (path) => {
      const session = await fixture({ rotationDue: true });
      const otherToken = tokens.issue();
      await repository.createSession(
        session.user.id,
        {
          expiresAt: new Date(now.getTime() + 3_600_000),
          tokenHash: otherToken.hash,
        },
        now,
      );
      const rotated = await me(session.cookie).expect(200);
      const cookie = String(rotated.headers['set-cookie']).split(';')[0]!;
      const response = await request(server).post(path).set('Cookie', cookie).expect(204);
      expect(String(response.headers['set-cookie'])).toContain('Max-Age=0');
      await me(cookie).expect(401);
      await me(session.cookie).expect(401);
      await me(`platform_session=${otherToken.raw}`).expect(
        path === '/auth/logout-all' ? 401 : 200,
      );
    },
  );

  it('allows logout using an overlapping predecessor and revokes the replacement too', async () => {
    const session = await fixture({ rotationDue: true });
    const rotated = await me(session.cookie).expect(200);
    const cookie = String(rotated.headers['set-cookie']).split(';')[0]!;
    await request(server).post('/auth/logout').set('Cookie', session.cookie).expect(204);
    await me(cookie).expect(401);
    await me(session.cookie).expect(401);
  });
});
