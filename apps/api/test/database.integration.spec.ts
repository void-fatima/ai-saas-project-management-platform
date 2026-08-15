import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';

describe('PostgreSQL persistence', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('executes a query against PostgreSQL', async () => {
    const rows = await prisma.$queryRaw<Array<{ connected: number }>>`SELECT 1 AS connected`;

    expect(rows).toEqual([{ connected: 1 }]);
  });
});
