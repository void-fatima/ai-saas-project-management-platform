import { validateEnvironment } from '../src/config/environment.validation.js';
import { loginSchema, registerSchema } from '../src/auth/auth.schemas.js';

const base = {
  WEB_ORIGIN: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
};

describe('Authentication configuration and identity boundaries', () => {
  it.each([
    'https://example.com/path',
    'https://example.com/',
    'https://example.com?q=1',
    'https://example.com#x',
    'ftp://example.com',
    'https://user:pass@example.com',
  ])('rejects unsupported origin %s', (WEB_ORIGIN) => {
    expect(() => validateEnvironment({ ...base, WEB_ORIGIN })).toThrow('WEB_ORIGIN');
  });
  it('requires production HTTPS and consistent lifetimes', () => {
    expect(() => validateEnvironment({ ...base, NODE_ENV: 'production' })).toThrow('HTTPS');
    expect(() => validateEnvironment({ ...base, SESSION_ROTATION_HOURS: 168 })).toThrow('Rotation');
    expect(() => validateEnvironment({ ...base, SESSION_ABSOLUTE_HOURS: 100 })).toThrow('Absolute');
    expect(
      validateEnvironment({
        ...base,
        NODE_ENV: 'production',
        WEB_ORIGIN: 'https://app.example.com',
      }).SESSION_ABSOLUTE_HOURS,
    ).toBe(720);
  });
  it('normalizes surrounding whitespace and casing before validating identity', () => {
    const input = { email: '  OWNER@Example.com  ', password: 'valid-password-42' };
    expect(loginSchema.parse(input).email).toBe('owner@example.com');
    expect(registerSchema.parse({ ...input, name: 'Owner' }).email).toBe('owner@example.com');
    expect(
      loginSchema.safeParse({ ...input, email: `${'a'.repeat(243)}@example.com` }).success,
    ).toBe(false);
  });
});
