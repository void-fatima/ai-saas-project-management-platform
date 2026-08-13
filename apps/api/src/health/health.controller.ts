import { Controller, Get } from '@nestjs/common';

interface HealthResponse {
  status: 'ok';
}

@Controller('health')
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return { status: 'ok' };
  }
}
