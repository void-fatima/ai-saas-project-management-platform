import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AUTH_REPOSITORY } from '../src/auth/auth.repository.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { MemoryAuthRepository } from './support/memory-auth.repository.js';

describe('HTTP authentication policy', () => {
  let app: INestApplication<Server>;
  let server: Server;
  const repository = new MemoryAuthRepository();
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(AUTH_REPOSITORY)
      .useValue(repository)
      .compile();
    app = moduleRef.createNestApplication<INestApplication<Server>>();
    await app.init();
    server = app.getHttpServer();
  });
  afterAll(async () => {
    await app?.close();
  });
  it('applies no-store and safe headers before authentication or validation fails', async () => {
    for (const response of [
      await request(server).get('/auth/me'),
      await request(server).post('/auth/register').send({}),
    ]) {
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['set-cookie']).toBeUndefined();
    }
  });
  it('rejects untrusted origins and cross-site browser requests', async () => {
    await request(server)
      .post('/auth/login')
      .set('Origin', 'https://untrusted.example')
      .send({})
      .expect(403);
    await request(server).get('/auth/me').set('Sec-Fetch-Site', 'cross-site').expect(403);
    await request(server)
      .post('/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({})
      .expect(400);
  });
  it('does not return infrastructure exception details from registration', async () => {
    vi.spyOn(repository, 'createUserWithSession').mockRejectedValueOnce(
      new Error('private-database-password'),
    );
    const response = await request(server)
      .post('/auth/register')
      .send({ name: 'Owner', email: 'safe@example.com', password: 'valid-password-42' })
      .expect(500);
    expect(JSON.stringify(response.body)).not.toContain('private-database-password');
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('keeps throttled responses non-cacheable and ignores forged forwarding headers', async () => {
    let status = 0;
    for (let attempt = 0; attempt < 6; attempt++) {
      const response = await request(server)
        .post('/auth/forgot-password')
        .set('X-Forwarded-For', `192.0.2.${attempt}`)
        .send({ email: 'unknown@example.com' });
      status = response.status;
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(status).toBe(429);
  });
});
