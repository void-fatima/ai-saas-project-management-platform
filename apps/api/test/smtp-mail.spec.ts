import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import { SmtpAccountMail } from '../src/auth/smtp-account-mail.service.js';
import { validateEnvironment, type Environment } from '../src/config/environment.validation.js';
import { OperationsLog } from '../src/operations/operations.js';

const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn(() => ({ sendMail })) } }));

describe('SMTP account delivery', () => {
  const config = new ConfigService<Environment, true>(
    validateEnvironment({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:password@localhost/platform',
      WEB_ORIGIN: 'https://app.example.com',
      MAIL_MODE: 'smtp',
      SMTP_HOST: 'smtp.example.com',
      SMTP_USER: 'account',
      SMTP_PASSWORD: 'private-password',
      SMTP_FROM: 'account@example.com',
    }),
  );
  it('requires verified TLS, bounded connections, plain text and disables content logging/fetching', async () => {
    sendMail.mockResolvedValue({ rejected: [] });
    // Mock at the public transport boundary; no third-party network is used.
    const delivery = new SmtpAccountMail(config, new OperationsLog(config));
    await delivery.send({
      to: 'recipient@example.com',
      purpose: 'invite',
      url: 'https://app.example.com/#invite=private-token',
    });
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        requireTLS: true,
        tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
        logger: false,
        debug: false,
        disableFileAccess: true,
        disableUrlAccess: true,
        connectionTimeout: 5000,
        socketTimeout: 10000,
      }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'Workspace invitation' }),
    );
    const sent: unknown = sendMail.mock.calls[0]?.[0];
    expect(sent).toHaveProperty('text');
    if (typeof sent !== 'object' || sent === null || !('text' in sent))
      throw new Error('Mail missing');
    expect(sent.text).toContain('#invite=private-token');
  });
  it('fails safely without exposing SMTP credentials, recipient or response', async () => {
    sendMail.mockRejectedValue(new Error('private-password private-token recipient@example.com'));
    const log = new OperationsLog(config);
    const output = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(
        new SmtpAccountMail(config, log).send({
          to: 'recipient@example.com',
          purpose: 'reset',
          url: 'https://app.example.com/#reset=private-token',
        }),
      ).rejects.toThrow('Account email delivery is unavailable.');
      expect(output).toHaveBeenCalledWith(expect.stringContaining('mail_failed'));
      expect(JSON.stringify(output.mock.calls)).not.toMatch(/private-|recipient/);
    } finally {
      output.mockRestore();
    }
  });
});
