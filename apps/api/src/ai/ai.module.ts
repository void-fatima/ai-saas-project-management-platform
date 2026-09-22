import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.validation.js';
import { AuthModule } from '../auth/auth.module.js';
import { WorkspaceModule } from '../workspaces/workspace.module.js';
import { ProjectModule } from '../projects/project.module.js';
import { AiProvider, DisabledAiProvider } from './ai.provider.js';
import { OpenAiProvider } from './openai.provider.js';
import { TestAiProvider } from './test.provider.js';
import { AiService } from './ai.service.js';
import { ProjectAiController, TaskAiController } from './ai.controller.js';

@Module({
  imports: [AuthModule, WorkspaceModule, ProjectModule],
  controllers: [ProjectAiController, TaskAiController],
  providers: [
    AiService,
    {
      provide: AiProvider,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) => {
        const provider = config.get('AI_PROVIDER', { infer: true });
        if (provider === 'test') return new TestAiProvider();
        if (provider === 'openai')
          return new OpenAiProvider(
            config.getOrThrow('AI_MODEL', { infer: true }),
            config.getOrThrow('AI_API_KEY', { infer: true }),
          );
        return new DisabledAiProvider();
      },
    },
  ],
})
export class AiModule {}
