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

interface Request {
  originalUrl: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
}
interface Response {
  setHeader(name: string, value: string): void;
  status(code: number): Response;
  json(body: unknown): void;
}

@Injectable()
export class HttpPolicy implements NestMiddleware {
  constructor(@Inject(ConfigService) private readonly config: ConfigService<Environment, true>) {}
  use(request: Request, response: Response, next: () => void): void {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    if (this.config.get('NODE_ENV', { infer: true }) === 'production')
      response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    const path = request.originalUrl.split('?')[0] ?? '';
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
        response.status(403).json({ statusCode: 403, message: 'Request origin is not permitted.' });
        return;
      }
    }
    next();
  }
}

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      response
        .status(exception.getStatus())
        .json(
          typeof body === 'string' ? { statusCode: exception.getStatus(), message: body } : body,
        );
      return;
    }
    // Never serialize the exception, request, body, headers, or database URL.
    console.error('Unhandled application request failure');
    response.status(500).json({ statusCode: 500, message: 'Unable to complete the request.' });
  }
}
