import { Controller, Get, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createServer, type Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AUTH_REPOSITORY } from '../src/auth/auth.repository.js';
import { SessionCookieService } from '../src/auth/session-cookie.service.js';
import { validateEnvironment, type Environment } from '../src/config/environment.validation.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { configureHttp } from '../src/operations/http-runtime.js';
import { RuntimeState } from '../src/operations/operations.js';
import { createShutdown } from '../src/operations/shutdown.js';
import { MemoryAuthRepository } from './support/memory-auth.repository.js';

const base = {
  NODE_ENV: 'production',
  WEB_ORIGIN: 'https://app.example.com',
  DATABASE_URL: 'postgresql://user:secret@localhost/app',
};
const config = new ConfigService<Environment, true>(validateEnvironment(base));
@Controller('ops-test')
class FailureController {
  @Get('error') fail() {
    throw new InternalServerErrorException('password=private-secret /internal/path');
  }
}

describe('production configuration', () => {
  it.each([
    { DATABASE_URL: undefined },
    { WEB_ORIGIN: undefined },
    { DATABASE_URL: 'postgresql://localhost/app' },
    { LOG_LEVEL: 'debug' },
    { TRUST_PROXY_HOPS: 2 },
    { TRUST_PROXY_HOPS: 'true' },
    { RATE_LIMIT_MAX: 0 },
    { SHUTDOWN_TIMEOUT_MS: 999999 },
    { MAIL_MODE: 'smtp' },
    { MAIL_MODE: 'development-file' },
    { AI_PROVIDER: 'test' },
  ])('rejects unsafe or missing settings %j', (change) => {
    expect(() => validateEnvironment({ ...base, ...change })).toThrow();
  });
  it('never includes rejected secret values in validation errors', () => {
    expect(() =>
      validateEnvironment({
        ...base,
        DATABASE_URL: 'private-secret',
        AI_API_KEY: 'private-secret',
      }),
    ).toThrow(/DATABASE_URL/);
    try {
      validateEnvironment({ ...base, DATABASE_URL: 'private-secret' });
    } catch (error) {
      expect(String(error)).not.toContain('private-secret');
    }
  });
  it('uses host-only secure HttpOnly Strict cookies behind TLS termination', () => {
    const setHeader = vi.fn();
    new SessionCookieService(config).write({ setHeader }, 'test-token', 60);
    expect(setHeader).toHaveBeenCalledWith(
      'Set-Cookie',
      expect.stringContaining('__Host-platform_session='),
    );
    const cookie: unknown = setHeader.mock.calls[0]?.[1];
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Domain=');
  });
});

describe('production HTTP boundary', () => {
  let app: NestExpressApplication<Server>;
  const checkReadiness = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const output = vi.spyOn(console, 'info').mockImplementation(() => {});
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [FailureController],
    })
      .overrideProvider(ConfigService)
      .useValue(config)
      .overrideProvider(PrismaService)
      .useValue({ checkReadiness })
      .overrideProvider(AUTH_REPOSITORY)
      .useValue(new MemoryAuthRepository())
      .compile();
    app = module.createNestApplication<NestExpressApplication<Server>>({ logger: false });
    configureHttp(app);
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    output.mockRestore();
    errors.mockRestore();
  });
  it('serves process liveness without probing dependencies and bounds readiness failure', async () => {
    checkReadiness.mockRejectedValueOnce(new Error('secret database URL'));
    const calls = checkReadiness.mock.calls.length;
    await request(app.getHttpServer()).get('/health').expect(200);
    expect(checkReadiness).toHaveBeenCalledTimes(calls);
    const failure = await request(app.getHttpServer()).get('/ready').expect(503);
    expect(failure.text).not.toContain('secret');
    await request(app.getHttpServer()).get('/ready').expect(200);
  });
  it('allows only exact configured CORS origin, credentials and exposes correlation ID', async () => {
    const response = await request(app.getHttpServer())
      .options('/auth/login')
      .set('Origin', base.WEB_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);
    expect(response.headers['access-control-allow-origin']).toBe(base.WEB_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['access-control-expose-headers']).toBe('X-Request-ID');
    await request(app.getHttpServer())
      .get('/health')
      .set('Origin', `${base.WEB_ORIGIN}.evil.com`)
      .expect(403);
  });
  it('returns safe errors with validated IDs and secure headers', async () => {
    const id = 'bd743520-ff32-4e63-8f7d-57eb632f48a9';
    const response = await request(app.getHttpServer())
      .get('/ops-test/error')
      .set('X-Request-ID', id)
      .expect(500);
    expect(response.headers['x-request-id']).toBe(id);
    expect(response.body).toMatchObject({ requestId: id });
    expect(response.text).not.toContain('private-secret');
    expect(response.headers['strict-transport-security']).toBe('max-age=31536000');
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    const replaced = await request(app.getHttpServer())
      .get('/health')
      .set('X-Request-ID', 'secret-token');
    expect(replaced.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('bounds bodies and redacts parser errors before routing', async () => {
    const large = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ password: 'x'.repeat(66000) })
      .expect(413);
    expect(large.headers['x-request-id']).toBeDefined();
    const malformed = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"password":"private-secret",oops}')
      .expect(400);
    expect(malformed.text).not.toContain('private-secret');
  });
  it('logs templates and status without queries, paths, headers, credentials or bodies', async () => {
    output.mockClear();
    errors.mockClear();
    await request(app.getHttpServer())
      .get('/ops-test/error?token=private-secret')
      .set('Cookie', 'session=private-secret')
      .set('Authorization', 'Bearer private-secret');
    await request(app.getHttpServer()).get('/private-secret?password=private-secret');
    const logs = JSON.stringify([...output.mock.calls, ...errors.mock.calls]);
    expect(logs).toContain('request_completed');
    expect(logs).toContain('/ops-test/error');
    expect(logs).not.toContain('private-secret');
    output.mockClear();
    await request(app.getHttpServer()).get('/health');
    expect(output).not.toHaveBeenCalled();
  });
  it('rejects new work while shutting down', async () => {
    app.get(RuntimeState).stopping = true;
    await request(app.getHttpServer()).get('/ready').expect(503);
    await request(app.getHttpServer()).get('/auth/me').expect(503);
    await request(app.getHttpServer()).get('/health').expect(200);
    app.get(RuntimeState).stopping = false;
  });
});

describe('shutdown lifecycle', () => {
  it('drains active requests, closes resources once, and stops accepting connections', async () => {
    const state = new RuntimeState();
    const order: string[] = [];
    const log = { write: vi.fn() };
    const server = createServer((_request, response) => {
      setTimeout(() => {
        order.push('response');
        response.end('ok');
      }, 30);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    // Minimal structural app boundary keeps this a real socket/drain test.
    const app = {
      get: (token: unknown) => (token === RuntimeState ? state : log),
      getHttpServer: () => server,
      close: () => {
        order.push('resources');
        return Promise.resolve();
      },
    };
    const exit = vi.fn();
    const shutdown = createShutdown(app, state, log, 1000, exit, () => order.push('streams'));
    const pending = request(server)
      .get('/')
      .then(() => {});
    await new Promise<void>((resolve) => server.once('request', () => resolve()));
    const closing = shutdown();
    expect(shutdown()).toBe(closing);
    expect(state.stopping).toBe(true);
    await Promise.all([pending, closing]);
    expect(order).toEqual(['streams', 'response', 'resources']);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(server.listening).toBe(false);
  });
  it('bounds a stalled cleanup with a nonzero exit', async () => {
    vi.useFakeTimers();
    const server = createServer();
    const state = new RuntimeState();
    const exit = vi.fn();
    vi.spyOn(server, 'close').mockImplementation((callback) => {
      callback?.();
      return server;
    });
    const log = { write: vi.fn() };
    const app = {
      get: (token: unknown) => (token === RuntimeState ? state : log),
      getHttpServer: () => server,
      close: () => new Promise<void>(() => {}),
    };
    void createShutdown(app, state, log, 1000, exit)();
    await vi.advanceTimersByTimeAsync(1000);
    expect(exit).toHaveBeenCalledWith(1);
    vi.useRealTimers();
  });
});
