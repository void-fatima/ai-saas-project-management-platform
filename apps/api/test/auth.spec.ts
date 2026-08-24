import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { AUTH_REPOSITORY } from '../src/auth/auth.repository.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { MemoryAuthRepository } from './support/memory-auth.repository.js';

const validAccount = {
  email: 'OWNER@EXAMPLE.COM',
  name: 'Platform Owner',
  password: 'correct-horse-42',
};

describe('Authentication API', () => {
  let app: INestApplication;
  let repository: MemoryAuthRepository;

  beforeAll(async () => {
    repository = new MemoryAuthRepository();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: vi.fn(),
        $disconnect: vi.fn(),
      })
      .overrideProvider(AUTH_REPOSITORY)
      .useValue(repository)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => repository.reset());

  afterAll(async () => {
    await app?.close();
  });

  it('rejects malformed registration data at the HTTP boundary', async () => {
    // Nest exposes the platform adapter as `any`; Supertest validates it at runtime.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'not-an-email', name: 'x', password: 'short' })
      .expect(400);

    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('registers, normalizes identity, authenticates another device, and revokes all sessions', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const firstDevice = request.agent(app.getHttpServer());
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const secondDevice = request.agent(app.getHttpServer());

    const registration = await firstDevice.post('/auth/register').send(validAccount).expect(201);

    expect(registration.body).toMatchObject({
      user: {
        email: 'owner@example.com',
        emailVerified: false,
        name: validAccount.name,
      },
    });
    expect(String(registration.headers['set-cookie'])).toContain('HttpOnly');
    expect(String(registration.headers['set-cookie'])).toContain('SameSite=Strict');
    expect(registration.headers['cache-control']).toBe('no-store');

    await firstDevice.post('/auth/register').send(validAccount).expect(409);
    await secondDevice
      .post('/auth/login')
      .send({ email: validAccount.email, password: 'wrong-password' })
      .expect(401, {
        message: 'Invalid email or password.',
        error: 'Unauthorized',
        statusCode: 401,
      });
    await secondDevice
      .post('/auth/login')
      .send({ email: validAccount.email, password: validAccount.password })
      .expect(200);

    await firstDevice.get('/auth/me').expect(200);
    await secondDevice.get('/auth/me').expect(200);
    await firstDevice.post('/auth/logout-all').expect(204);
    await firstDevice.get('/auth/me').expect(401);
    await secondDevice.get('/auth/me').expect(401);
  });

  it('revokes only the current session on logout', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const device = request.agent(app.getHttpServer());
    await device.post('/auth/register').send(validAccount).expect(201);
    await device.post('/auth/logout').expect(204);
    await device.get('/auth/me').expect(401);
  });
});
