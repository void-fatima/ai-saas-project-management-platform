import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { AccountMailDelivery, type AccountMail } from '../src/auth/account-mail.service.js';
import { AccountRecoveryService } from '../src/auth/account-recovery.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import { registerSchema } from '../src/auth/auth.schemas.js';
import { PrismaAuthRepository } from '../src/auth/prisma-auth.repository.js';
import { SessionTokenService } from '../src/auth/session-token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

describe('PostgreSQL account recovery', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;
  let recovery: AccountRecoveryService;
  let userId: string | undefined;
  let email: string;
  let originalToken: string;
  const messages: AccountMail[] = [];
  const tokens = new SessionTokenService();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AccountMailDelivery)
      .useValue({
        assertAvailable() {},
        send(message: AccountMail) {
          messages.push(message);
          return Promise.resolve();
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    auth = app.get(AuthService);
    recovery = app.get(AccountRecoveryService);
  });
  beforeEach(async () => {
    messages.length = 0;
    email = `recovery-${randomUUID()}@example.com`;
    const registration = await auth.register(
      registerSchema.parse({
        name: 'Recovery Owner',
        email: `  ${email.toUpperCase()}  `,
        password: 'initial-password-42',
      }),
    );
    userId = registration.user.id;
    originalToken = registration.token;
  });
  afterEach(async () => {
    if (userId) {
      await prisma.user.delete({ where: { id: userId } });
      userId = undefined;
    }
  });
  afterAll(async () => {
    await app?.close();
  });
  async function link(kind: 'VERIFY_EMAIL' | 'RESET_PASSWORD') {
    await recovery.request(email, kind);
    return new URL(messages.at(-1)!.url).hash.split('=')[1]!;
  }

  it('rejects normalized duplicate identity and rolls back registration on session collision', async () => {
    await expect(
      auth.register(
        registerSchema.parse({
          name: 'Duplicate',
          email: email.toUpperCase(),
          password: 'initial-password-42',
        }),
      ),
    ).rejects.toThrow('Unable to create');
    const collisionEmail = `rollback-${randomUUID()}@example.com`;
    expect(
      await app
        .get(PrismaAuthRepository)
        .createUserWithSession(
          { email: collisionEmail, name: 'Rollback', passwordHash: 'unused' },
          { expiresAt: new Date(Date.now() + 60_000), tokenHash: tokens.hash(originalToken) },
          new Date(),
        ),
    ).toBeNull();
    expect(await prisma.user.findUnique({ where: { email: collisionEmail } })).toBeNull();
  });

  it.each(['VERIFY_EMAIL', 'RESET_PASSWORD'] as const)(
    'rejects expired %s tokens',
    async (kind) => {
      const raw = await link(kind);
      await prisma.accountToken.update({
        where: { tokenHash: tokens.hash(raw) },
        data: { expiresAt: new Date(0) },
      });
      await expect(recovery.consume(raw, kind, 'replacement-password-42')).rejects.toThrow(
        'invalid, expired, or already used',
      );
      await expect(auth.authenticate(originalToken)).resolves.toBeDefined();
    },
  );

  it.each(['VERIFY_EMAIL', 'RESET_PASSWORD'] as const)(
    'allows exactly one concurrent %s consumption and rejects replay',
    async (kind) => {
      const raw = await link(kind);
      const stored = await prisma.accountToken.findUniqueOrThrow({
        where: { tokenHash: tokens.hash(raw) },
      });
      expect(stored.tokenHash).not.toBe(raw);
      const results = await Promise.allSettled([
        recovery.consume(raw, kind, 'replacement-password-42'),
        recovery.consume(raw, kind, 'replacement-password-42'),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      await expect(recovery.consume(raw, kind, 'replacement-password-42')).rejects.toThrow(
        'already used',
      );
      if (kind === 'VERIFY_EMAIL')
        expect(
          (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).emailVerifiedAt,
        ).not.toBeNull();
      else {
        await expect(auth.authenticate(originalToken)).rejects.toThrow();
        await expect(auth.login({ email, password: 'initial-password-42' })).rejects.toThrow(
          'Invalid',
        );
        await expect(
          auth.login({ email, password: 'replacement-password-42' }),
        ).resolves.toBeDefined();
      }
    },
  );

  it('does not create a session from a password checked before reset', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const raw = await link('RESET_PASSWORD');
    await recovery.consume(raw, 'RESET_PASSWORD', 'replacement-password-42');
    expect(
      await app
        .get(PrismaAuthRepository)
        .createSession(
          user.id,
          { expiresAt: new Date(Date.now() + 60_000), tokenHash: tokens.issue().hash },
          new Date(),
          user.passwordHash,
        ),
    ).toBeNull();
  });
});
