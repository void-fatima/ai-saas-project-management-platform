import {
  Catch,
  HttpException,
  Inject,
  Injectable,
  type ArgumentsHost,
  type ExceptionFilter,
  type NestMiddleware,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.validation.js';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { OperationsLog, RuntimeState } from '../operations/operations.js';

interface Request {
  requestId?: string;
  policyApplied?: boolean;
  route?: { path?: unknown };
  originalUrl: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
}
interface Response {
  statusCode: number;
  headersSent: boolean;
  once(event: 'close', callback: () => void): void;
  setHeader(name: string, value: string): void;
  status(code: number): Response;
  json(body: unknown): void;
}

@Injectable()
export class HttpPolicy implements NestMiddleware {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<Environment, true>,
    @Inject(OperationsLog) private readonly log: OperationsLog,
    @Inject(RuntimeState) private readonly runtime: RuntimeState,
  ) {}
  use(request: Request, response: Response, next: () => void): void {
    if (request.policyApplied) {
      next();
      return;
    }
    request.policyApplied = true;
    const incoming = request.headers['x-request-id'];
    const requestId =
      typeof incoming === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(incoming)
        ? incoming.toLowerCase()
        : randomUUID();
    request.requestId = requestId;
    response.setHeader('X-Request-ID', requestId);
    const started = performance.now();
    response.once('close', () => {
      // Route templates omit IDs, query strings and untrusted unmatched paths.
      const path = typeof request.route?.path === 'string' ? request.route.path : '<unmatched>';
      if (['/health', '/ready', '/health/ready'].includes(path) && response.statusCode < 400)
        return;
      this.log.write(response.statusCode >= 500 ? 'error' : 'info', 'request_completed', {
        requestId,
        method: /^[A-Z]{1,12}$/.test(request.method) ? request.method : 'OTHER',
        path,
        status: response.statusCode,
        durationMs: Math.round(performance.now() - started),
      });
    });
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    response.setHeader('Cache-Control', 'no-store');
    if (this.config.get('NODE_ENV', { infer: true }) === 'production')
      response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    const path = request.originalUrl.split('?')[0] ?? '';
    if (this.runtime.stopping && path !== '/health') {
      response.setHeader('Connection', 'close');
      response.status(503).json({ statusCode: 503, message: 'Service is stopping.', requestId });
      return;
    }
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== this.config.get('WEB_ORIGIN', { infer: true })) {
      response
        .status(403)
        .json({ statusCode: 403, message: 'Request origin is not permitted.', requestId });
      return;
    }
    if (
      path === '/auth' ||
      path.startsWith('/auth/') ||
      /^\/(workspaces|notifications|realtime)(?:\/|$)/i.test(path)
    ) {
      response.setHeader('Cache-Control', 'no-store');
      const origin = request.headers.origin;
      if (
        request.headers['sec-fetch-site'] === 'cross-site' ||
        (request.method !== 'GET' &&
          request.method !== 'HEAD' &&
          origin !== undefined &&
          origin !== this.config.get('WEB_ORIGIN', { infer: true }))
      ) {
        response
          .status(403)
          .json({ statusCode: 403, message: 'Request origin is not permitted.', requestId });
        return;
      }
    }
    next();
  }
}

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  constructor(@Inject(OperationsLog) private readonly log: OperationsLog) {}
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { requestId } = host.switchToHttp().getRequest<Request>();
    if (response.headersSent) return;
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      if (statusCode >= 500 || statusCode === 404) {
        if (statusCode >= 500)
          this.log.write('error', 'request_failed', { requestId, status: statusCode });
        response.status(statusCode).json({
          statusCode,
          message: statusCode === 404 ? 'Resource not found.' : 'Service temporarily unavailable.',
          requestId,
        });
        return;
      }
      const body = exception.getResponse();
      response
        .status(exception.getStatus())
        .json(
          typeof body === 'string'
            ? { statusCode, message: body, requestId }
            : { ...body, requestId },
        );
      return;
    }
    // Never serialize the exception, request, body, headers, or database URL.
    this.log.write('error', 'request_failed', { requestId, status: 500 });
    response
      .status(500)
      .json({ statusCode: 500, message: 'Unable to complete the request.', requestId });
  }
}
