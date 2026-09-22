import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import type { Environment } from '../config/environment.validation.js';
import { OperationsLog } from '../operations/operations.js';
import { AccountMailDelivery, type AccountMail } from './account-mail.service.js';

@Injectable()
export class SmtpAccountMail extends AccountMailDelivery {
  private readonly transport;
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<Environment, true>,
    @Inject(OperationsLog) private readonly log: OperationsLog,
  ) {
    super();
    this.transport = nodemailer.createTransport({
      host: config.get('SMTP_HOST', { infer: true }),
      port: config.get('SMTP_PORT', { infer: true }),
      secure: config.get('SMTP_SECURE', { infer: true }) === 'true',
      requireTLS: true,
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      auth: {
        user: config.get('SMTP_USER', { infer: true }),
        pass: config.get('SMTP_PASSWORD', { infer: true }),
      },
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }
  assertAvailable(): void {
    if (this.config.get('MAIL_MODE', { infer: true }) !== 'smtp')
      throw new ServiceUnavailableException('Account email delivery is unavailable.');
  }
  async send(message: AccountMail): Promise<void> {
    this.assertAvailable();
    const subjects = {
      verify: 'Verify your email',
      reset: 'Reset your password',
      invite: 'Workspace invitation',
    };
    try {
      const result = await this.transport.sendMail({
        from: this.config.get('SMTP_FROM', { infer: true }),
        to: message.to,
        subject: subjects[message.purpose],
        text: `${subjects[message.purpose]}\n\n${message.url}\n\nIf you did not expect this email, you can ignore it.`,
      });
      if (result.rejected.length) throw new Error('Delivery rejected');
    } catch {
      this.log.write('error', 'mail_failed');
      throw new ServiceUnavailableException('Account email delivery is unavailable.');
    }
  }
}
