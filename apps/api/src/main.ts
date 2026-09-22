import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Server } from 'node:http';

import { AppModule } from './app.module.js';
import {
  EnvironmentConfigurationError,
  type Environment,
} from './config/environment.validation.js';
import { configureHttp } from './operations/http-runtime.js';
import { OperationsLog, RuntimeState } from './operations/operations.js';
import { createShutdown } from './operations/shutdown.js';
import { RealtimeService } from './collaboration/realtime.service.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication<Server>>(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const config = app.get<ConfigService<Environment, true>>(ConfigService);

  configureHttp(app);

  const port = config.get('API_PORT', { infer: true });
  await app.listen(port);
  app.get(OperationsLog).write('info', 'startup', { port });
  const shutdown = createShutdown(
    app,
    app.get(RuntimeState),
    app.get(OperationsLog),
    config.get('SHUTDOWN_TIMEOUT_MS', { infer: true }),
    undefined,
    () => app.get(RealtimeService).beginShutdown(),
  );
  for (const signal of ['SIGTERM', 'SIGINT'] as const)
    process.once(signal, () => {
      void shutdown();
    });
}

bootstrap().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'startup_failed',
      message:
        error instanceof EnvironmentConfigurationError
          ? error.message
          : 'Check service configuration and database availability.',
    }),
  );
  process.exit(1);
});
