import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';

describe('GET /health', () => {
  let app: INestApplication;
  const checkReadiness = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: vi.fn(),
        $disconnect: vi.fn(),
        checkReadiness,
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns only the public service status', async () => {
    // Nest exposes the platform adapter as `any`; Supertest validates it at runtime.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const response = await request(app.getHttpServer()).get('/health').expect(200);

    expect(response.body).toEqual({ status: 'ok' });
  });

  it('checks database readiness without exposing database failures', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await request(app.getHttpServer()).get('/health/ready').expect(200, { status: 'ok' });
    checkReadiness.mockRejectedValueOnce(new Error('private-connection-details'));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const response = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(JSON.stringify(response.body)).not.toContain('private-connection-details');
  });

  it('bounds a stalled readiness probe', async () => {
    checkReadiness.mockImplementationOnce(() => new Promise(() => {}));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await request(app.getHttpServer()).get('/health/ready').expect(503);
  });
});
