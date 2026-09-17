import { ConfigService } from '@nestjs/config';
import { AccountRecoveryService } from '../src/auth/account-recovery.service.js';
import {
  DevelopmentAccountMail,
  type AccountMailDelivery,
} from '../src/auth/account-mail.service.js';
import type { AccountTokenRepository } from '../src/auth/account-token.repository.js';
import { PasswordService } from '../src/auth/password.service.js';
import { SessionTokenService } from '../src/auth/session-token.service.js';
import { validateEnvironment, type Environment } from '../src/config/environment.validation.js';
import { MemoryAuthRepository } from './support/memory-auth.repository.js';

describe('Account recovery delivery and service boundaries', () => {
  const tokens = new SessionTokenService();
  const config = new ConfigService<Environment, true>(
    validateEnvironment({
      WEB_ORIGIN: 'http://localhost:5173',
      DATABASE_URL: 'postgresql://test:test@localhost/test',
      MAIL_MODE: 'development-file',
    }),
  );
  let users: MemoryAuthRepository;
  const createRepository = () => ({
    issue: vi.fn<AccountTokenRepository['issue']>().mockResolvedValue(true),
    consume: vi.fn<AccountTokenRepository['consume']>().mockResolvedValue(true),
    invalidate: vi.fn<AccountTokenRepository['invalidate']>().mockResolvedValue(undefined),
  });
  let repository: ReturnType<typeof createRepository>;
  const createDelivery = () => ({
    assertAvailable: vi.fn<AccountMailDelivery['assertAvailable']>(),
    send: vi.fn<AccountMailDelivery['send']>().mockResolvedValue(undefined),
  });
  let delivery: ReturnType<typeof createDelivery>;
  let service: AccountRecoveryService;

  beforeEach(async () => {
    users = new MemoryAuthRepository();
    await users.createUserWithSession(
      { name: 'Owner', email: 'owner@example.com', passwordHash: 'unused' },
      { expiresAt: new Date(Date.now() + 60_000), tokenHash: tokens.issue().hash },
      new Date(),
    );
    repository = createRepository();
    delivery = createDelivery();
    service = new AccountRecoveryService(
      users,
      repository,
      delivery,
      new PasswordService(),
      tokens,
      config,
    );
  });

  it('stores only a hash and delivers a bounded verification link without returning its secret', async () => {
    await expect(service.request('owner@example.com', 'VERIFY_EMAIL')).resolves.toBeUndefined();
    const send = vi.mocked(delivery.send).mock.calls[0]![0];
    const raw = new URL(send.url).hash.split('=')[1]!;
    expect(tokens.isValid(raw)).toBe(true);
    const args = vi.mocked(repository.issue).mock.calls[0]!;
    expect(args[2]).toBe(tokens.hash(raw));
    expect(args[2]).not.toBe(raw);
    expect(args[4].getTime() - args[3].getTime()).toBe(24 * 3_600_000);
  });

  it('does not send mail or expose account existence for unknown accounts or cooldowns', async () => {
    await expect(service.request('missing@example.com', 'RESET_PASSWORD')).resolves.toBeUndefined();
    vi.mocked(repository.issue).mockResolvedValueOnce(false);
    await expect(service.request('owner@example.com', 'RESET_PASSWORD')).resolves.toBeUndefined();
    expect(delivery.send).not.toHaveBeenCalled();
  });

  it('invalidates a token after delivery failure and returns a safe error', async () => {
    vi.mocked(delivery.send).mockRejectedValueOnce(new Error('private transport details'));
    await expect(service.request('owner@example.com', 'RESET_PASSWORD')).rejects.toThrow(
      'Account email delivery is unavailable.',
    );
    expect(repository.invalidate).toHaveBeenCalledWith(
      vi.mocked(repository.issue).mock.calls[0]![2],
    );
  });

  it('hashes reset passwords and treats expiry/replay identically', async () => {
    vi.mocked(repository.consume).mockResolvedValueOnce(false);
    await expect(
      service.consume(tokens.issue().raw, 'RESET_PASSWORD', 'valid-password-42'),
    ).rejects.toThrow('invalid, expired, or already used');
    expect(vi.mocked(repository.consume).mock.calls[0]![3]).toMatch(/^\$argon2id\$/);
  });

  it('rejects malformed tokens before persistence', async () => {
    await expect(service.consume('bad', 'VERIFY_EMAIL')).rejects.toThrow('invalid');
    expect(repository.consume).not.toHaveBeenCalled();
  });

  it('fails honestly when production delivery is not configured', () => {
    const production = new ConfigService<Environment, true>(
      validateEnvironment({
        WEB_ORIGIN: 'https://app.example.com',
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://test:test@localhost/test',
      }),
    );
    expect(() => new DevelopmentAccountMail(production).assertAvailable()).toThrow('unavailable');
    expect(() =>
      validateEnvironment({
        WEB_ORIGIN: 'https://app.example.com',
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://test:test@localhost/test',
        MAIL_MODE: 'development-file',
      }),
    ).toThrow('forbidden');
  });
});
