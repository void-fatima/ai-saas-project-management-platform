import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parse, serialize } from 'cookie';

import type { Environment } from '../config/environment.validation.js';
import type { HttpResponse } from './auth.types.js';

@Injectable()
export class SessionCookieService {
  private readonly production: boolean;
  private readonly cookieName: string;

  constructor(@Inject(ConfigService) config: ConfigService<Environment, true>) {
    this.production = config.get('NODE_ENV', { infer: true }) === 'production';
    this.cookieName = this.production ? '__Host-platform_session' : 'platform_session';
  }

  read(cookieHeader: string | undefined): string | undefined {
    if (!cookieHeader) return undefined;
    return parse(cookieHeader)[this.cookieName];
  }

  write(response: HttpResponse, token: string, maxAgeSeconds: number): void {
    response.setHeader(
      'Set-Cookie',
      serialize(this.cookieName, token, {
        httpOnly: true,
        maxAge: maxAgeSeconds,
        path: '/',
        sameSite: 'strict',
        secure: this.production,
      }),
    );
  }

  clear(response: HttpResponse): void {
    response.setHeader(
      'Set-Cookie',
      serialize(this.cookieName, '', {
        expires: new Date(0),
        httpOnly: true,
        maxAge: 0,
        path: '/',
        sameSite: 'strict',
        secure: this.production,
      }),
    );
  }
}
