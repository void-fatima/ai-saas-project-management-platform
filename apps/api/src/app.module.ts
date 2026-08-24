import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AuthModule } from './auth/auth.module.js';
import { validateEnvironment } from './config/environment.validation.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      envFilePath: ['../../.env', '.env'],
      isGlobal: true,
      validate: validateEnvironment,
    }),
    ThrottlerModule.forRoot([{ name: 'default', limit: 100, ttl: 60_000 }]),
    DatabaseModule,
    AuthModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
