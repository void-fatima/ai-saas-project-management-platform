import { Injectable, type OnApplicationShutdown } from '@nestjs/common';

import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
