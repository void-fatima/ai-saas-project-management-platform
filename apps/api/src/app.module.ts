import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { HttpPolicy, SafeExceptionFilter } from './common/http-policy.js';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AuthModule } from './auth/auth.module.js';
import { WorkspaceModule } from './workspaces/workspace.module.js';
import { ProjectModule } from './projects/project.module.js';
import { validateEnvironment, type Environment } from './config/environment.validation.js';
import { OperationsModule } from './operations/operations.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { WorkspaceSignalsModule } from './collaboration/workspace-signals.js';
import { CollaborationModule } from './collaboration/collaboration.module.js';
import { DiscoveryModule } from './discovery/discovery.module.js';
import { AiModule } from './ai/ai.module.js';
import { ReportingModule } from './reporting/reporting.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      envFilePath: ['../../.env', '.env'],
      isGlobal: true,
      validate: validateEnvironment,
    }),
    OperationsModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) => [
        {
          name: 'default',
          limit: config.get('RATE_LIMIT_MAX', { infer: true }),
          ttl: config.get('RATE_LIMIT_WINDOW_MS', { infer: true }),
        },
      ],
    }),
    DatabaseModule,
    WorkspaceSignalsModule,
    AuthModule,
    WorkspaceModule,
    ProjectModule,
    CollaborationModule,
    DiscoveryModule,
    AiModule,
    ReportingModule,
  ],
  controllers: [HealthController],
  providers: [
    HttpPolicy,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: SafeExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpPolicy).forRoutes('{*path}');
  }
}
