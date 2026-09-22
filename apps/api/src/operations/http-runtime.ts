import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { HttpPolicy } from '../common/http-policy.js';
import type { Environment } from '../config/environment.validation.js';

export function configureHttp(app: NestExpressApplication<Server>): void {
  const config = app.get<ConfigService<Environment, true>>(ConfigService);
  app.disable('x-powered-by');
  // Exactly one trusted hop: the private web proxy overwrites client forwarding headers.
  app.set('trust proxy', config.get('TRUST_PROXY_HOPS', { infer: true }));
  const policy = app.get(HttpPolicy);
  app.use(policy.use.bind(policy));
  app.enableCors({
    origin: config.get('WEB_ORIGIN', { infer: true }),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Request-ID'],
    exposedHeaders: ['X-Request-ID'],
    maxAge: 600,
  });
  app.useBodyParser('json', { limit: '64kb', strict: true });
  app.useBodyParser('urlencoded', { limit: '64kb', extended: false, parameterLimit: 100 });
  app.use(
    (
      error: unknown,
      _request: IncomingMessage,
      response: ServerResponse,
      next: (error: unknown) => void,
    ) => {
      if (
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        (error.status === 400 || error.status === 413)
      ) {
        response.statusCode = error.status;
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            statusCode: error.status,
            message: error.status === 413 ? 'Request body is too large.' : 'Invalid request body.',
            requestId: response.getHeader('X-Request-ID'),
          }),
        );
      } else next(error);
    },
  );
  const server = app.getHttpServer();
  server.headersTimeout = 10000;
  server.requestTimeout = 30000;
  server.keepAliveTimeout = 5000;
}
