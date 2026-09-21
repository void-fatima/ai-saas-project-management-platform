import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { HttpPolicy, SafeExceptionFilter } from './common/http-policy.js';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AuthModule } from './auth/auth.module.js';
import { WorkspaceModule } from './workspaces/workspace.module.js';
import { ProjectModule } from './projects/project.module.js';
import { validateEnvironment } from './config/environment.validation.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { WorkspaceSignalsModule } from './collaboration/workspace-signals.js';
import { CollaborationModule } from './collaboration/collaboration.module.js';
import { DiscoveryModule } from './discovery/discovery.module.js';

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
    WorkspaceSignalsModule,
    AuthModule,
    WorkspaceModule,
    ProjectModule,
    CollaborationModule,
    DiscoveryModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: SafeExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpPolicy).forRoutes('{*path}');
  }
}
