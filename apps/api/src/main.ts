import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import type { Environment } from './config/environment.validation.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  const config = app.get<ConfigService<Environment, true>>(ConfigService);

  app.enableCors({
    origin: config.get('WEB_ORIGIN', { infer: true }),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.enableShutdownHooks();

  const port = config.get('API_PORT', { infer: true });
  await app.listen(port);
  console.info(`API listening on port ${port}`);
}

bootstrap().catch(() => {
  console.error('API startup failed. Check service configuration and database availability.');
  process.exitCode = 1;
});
