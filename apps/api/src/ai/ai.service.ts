import { HttpException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { Environment } from '../config/environment.validation.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AiOperation } from '../generated/prisma/client.js';
import { WorkspaceAccess } from '../workspaces/workspace-access.service.js';
import { requirePermission } from '../workspaces/workspace.policy.js';
import { resourcePermissions } from '../projects/project.policy.js';
import { AiProvider, AiFailure, generateWithDeadline } from './ai.provider.js';
import { AiScope } from './ai.repository.js';
import { outputSchemas, type AiParams } from './ai.schemas.js';

const usageSchema = z
  .object({
    inputTokens: z.number().int().min(0).max(10000000),
    outputTokens: z.number().int().min(0).max(10000000),
  })
  .strict();
@Injectable()
export class AiService {
  constructor(
    @Inject(WorkspaceAccess) private readonly access: WorkspaceAccess,
    @Inject(AiProvider) private readonly provider: AiProvider,
    @Inject(ConfigService) private readonly config: ConfigService<Environment, true>,
    @Inject(PrismaService) private readonly db: PrismaService,
  ) {}
  async generate(p: AiParams, userId: string, requestId: string, operation: AiOperation) {
    const context = await this.access.run(p.workspaceId, userId, 'view', async (scope, role) => {
      // Preview consumes provider resources and writes a cost reservation; Viewer stays read-only.
      requirePermission(resourcePermissions(role).edit);
      const ai = scope.bind((tx, id) => new AiScope(tx, id));
      const context = await ai.context(p, operation);
      if (this.provider.name === 'disabled')
        throw new HttpException('AI assistance is not configured.', 503);
      await ai.reserve(
        p,
        userId,
        requestId,
        operation,
        context.taskVersion,
        this.provider.name,
        this.provider.model,
      );
      return context;
    });
    const started = Date.now();
    try {
      const result = await generateWithDeadline(
        this.provider,
        {
          operation,
          context: context.text,
          schema: z.toJSONSchema(outputSchemas[operation]),
          maxOutputTokens: this.config.get('AI_MAX_OUTPUT_TOKENS', { infer: true }),
        },
        this.config.get('AI_TIMEOUT_MS', { infer: true }),
      );
      if (Buffer.byteLength(JSON.stringify(result.output) ?? '') > 24000)
        throw new AiFailure('invalid');
      const parsed = outputSchemas[operation].safeParse(result.output);
      const usage = result.usage === undefined ? undefined : usageSchema.safeParse(result.usage);
      if (!parsed.success || (usage && !usage.success)) throw new AiFailure('invalid');
      const normalizedUsage = usage?.success ? usage.data : undefined;
      // Reauthorize after network work: a removed/demoted member never receives the generated result.
      return await this.access.run(p.workspaceId, userId, 'view', async (scope, role) => {
        requirePermission(resourcePermissions(role).edit);
        const ai = scope.bind((tx, id) => new AiScope(tx, id));
        const latest = await ai.context(p, operation);
        if (latest.text !== context.text || latest.taskVersion !== context.taskVersion)
          throw new HttpException('Content changed. Generate a fresh suggestion.', 409);
        await ai.complete(requestId, Date.now() - started, normalizedUsage);
        return {
          requestId,
          operation,
          suggestion: parsed.data,
          contextTruncated: context.truncated,
          provider: this.provider.name,
          model: this.provider.model,
          usage: normalizedUsage ?? null,
        };
      });
    } catch (error: unknown) {
      // Metadata-only cleanup remains tenant/user scoped even after membership removal.
      await this.db.aiRun.updateMany({
        where: { workspaceId: p.workspaceId, userId, id: requestId, status: 'PENDING' },
        data: { status: 'FAILED', durationMs: Date.now() - started },
      });
      if (error instanceof HttpException) throw error;
      const code = error instanceof AiFailure ? error.code : 'invalid';
      throw new HttpException(
        code === 'timeout'
          ? 'AI assistance timed out. Retry explicitly.'
          : code === 'invalid'
            ? 'The provider returned an unusable suggestion. Nothing was applied.'
            : 'AI assistance is temporarily unavailable.',
        code === 'timeout' ? 504 : code === 'invalid' ? 502 : 503,
      );
    }
  }
}
