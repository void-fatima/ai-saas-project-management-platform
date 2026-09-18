import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Environment } from '../config/environment.validation.js';

export interface AccountMail {
  to: string;
  purpose: 'verify' | 'reset' | 'invite';
  url: string;
}
export abstract class AccountMailDelivery {
  abstract assertAvailable(): void;
  abstract send(message: AccountMail): Promise<void>;
}

// This local mailbox is a delivery sink, not a log, API response, or token database.
// Production must install a real adapter; it must never silently use this transport.
@Injectable()
export class DevelopmentAccountMail extends AccountMailDelivery {
  constructor(@Inject(ConfigService) private readonly config: ConfigService<Environment, true>) {
    super();
  }
  assertAvailable(): void {
    if (
      this.config.get('NODE_ENV', { infer: true }) === 'production' ||
      this.config.get('MAIL_MODE', { infer: true }) !== 'development-file'
    ) {
      throw new ServiceUnavailableException('Account email delivery is unavailable.');
    }
  }
  async send(message: AccountMail): Promise<void> {
    this.assertAvailable();
    const directory = resolve(import.meta.dirname, '../../../../.tools/mail');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(
      resolve(directory, `${randomUUID()}.json`),
      JSON.stringify({ ...message, developmentOnly: true }),
      { mode: 0o600, flag: 'wx' },
    );
  }
}
