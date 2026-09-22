import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.validation.js';

type Level = 'info' | 'warn' | 'error';
type Event =
  | 'request_completed'
  | 'request_failed'
  | 'startup'
  | 'shutdown_started'
  | 'shutdown_complete'
  | 'shutdown_timeout'
  | 'shutdown_failed'
  | 'realtime_unavailable'
  | 'mail_failed';
interface Fields {
  requestId?: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  port?: number;
}

// Only allowlisted metadata crosses this boundary. Never pass errors or requests.
@Injectable()
export class OperationsLog {
  constructor(@Inject(ConfigService) private readonly config: ConfigService<Environment, true>) {}
  write(level: Level, event: Event, fields: Fields = {}): void {
    const levels = { info: 0, warn: 1, error: 2 };
    if (levels[level] < levels[this.config.get('LOG_LEVEL', { infer: true }) ?? 'info']) return;
    const line = JSON.stringify({
      time: new Date().toISOString(),
      level,
      event,
      requestId: fields.requestId,
      method: fields.method,
      path: fields.path,
      status: fields.status,
      durationMs: fields.durationMs,
      port: fields.port,
    });
    if (level === 'error') console.error(line);
    else console.info(line);
  }
}

@Injectable()
export class RuntimeState {
  stopping = false;
}

@Global()
@Module({ providers: [OperationsLog, RuntimeState], exports: [OperationsLog, RuntimeState] })
export class OperationsModule {}
