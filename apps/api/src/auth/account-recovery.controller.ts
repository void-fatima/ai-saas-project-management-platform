import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AccountRecoveryService } from './account-recovery.service.js';
import {
  emailRequestSchema,
  resetInputSchema,
  tokenInputSchema,
  type EmailRequestInput,
  type ResetInput,
  type TokenInput,
} from './auth.schemas.js';

const accepted = {
  message:
    'If the account is eligible, an email will be delivered. Check your inbox and wait a minute before requesting another.',
};

@Controller('auth')
@Throttle({ default: { limit: 5, ttl: 60_000 } })
export class AccountRecoveryController {
  constructor(@Inject(AccountRecoveryService) private readonly recovery: AccountRecoveryService) {}

  @Post('resend-verification')
  @HttpCode(202)
  async resend(@Body(new ZodValidationPipe(emailRequestSchema)) input: EmailRequestInput) {
    await this.recovery.request(input.email, 'VERIFY_EMAIL');
    return accepted;
  }

  @Post('forgot-password')
  @HttpCode(202)
  async forgot(@Body(new ZodValidationPipe(emailRequestSchema)) input: EmailRequestInput) {
    await this.recovery.request(input.email, 'RESET_PASSWORD');
    return accepted;
  }

  @Post('verify-email')
  @HttpCode(204)
  verify(@Body(new ZodValidationPipe(tokenInputSchema)) input: TokenInput) {
    return this.recovery.consume(input.token, 'VERIFY_EMAIL');
  }

  @Post('reset-password')
  @HttpCode(204)
  reset(@Body(new ZodValidationPipe(resetInputSchema)) input: ResetInput) {
    return this.recovery.consume(input.token, 'RESET_PASSWORD', input.password);
  }
}
