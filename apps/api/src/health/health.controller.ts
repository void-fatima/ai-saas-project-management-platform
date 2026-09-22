import { Controller, Get, Inject, Header, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../database/prisma.service.js';
import { RuntimeState } from '../operations/operations.js';

interface HealthResponse {
  status: 'ok';
}

@Controller()
@SkipThrottle()
export class HealthController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RuntimeState) private readonly runtime: RuntimeState,
  ) {}
  @Get('health')
  @Header('Cache-Control', 'no-store')
  getHealth(): HealthResponse {
    return { status: 'ok' };
  }

  @Get(['ready', 'health/ready'])
  @Header('Cache-Control', 'no-store')
  async readiness(): Promise<HealthResponse> {
    if (this.runtime.stopping) throw new ServiceUnavailableException('Service is not ready.');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.prisma.checkReadiness(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Readiness timeout')), 2500);
        }),
      ]);
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException('Service is not ready.');
    } finally {
      clearTimeout(timer);
    }
  }
}
