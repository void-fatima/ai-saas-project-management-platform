import type { AiOperation } from '../generated/prisma/client.js';

export interface AiGeneration {
  operation: AiOperation;
  context: string;
  schema: Record<string, unknown>;
  signal: AbortSignal;
  maxOutputTokens: number;
}
export interface AiResult {
  output: unknown;
  usage?: { inputTokens: number; outputTokens: number };
}
export abstract class AiProvider {
  abstract readonly name: string;
  abstract readonly model: string;
  abstract generate(input: AiGeneration): Promise<AiResult>;
}
export class AiFailure extends Error {
  constructor(readonly code: 'disabled' | 'unavailable' | 'invalid' | 'timeout') {
    super(code);
  }
}
export class DisabledAiProvider extends AiProvider {
  readonly name = 'disabled';
  readonly model = 'none';
  generate(): Promise<AiResult> {
    return Promise.reject(new AiFailure('disabled'));
  }
}

export async function generateWithDeadline(
  provider: AiProvider,
  input: Omit<AiGeneration, 'signal'>,
  timeoutMs: number,
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AiFailure('timeout'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      provider.generate({ ...input, signal: controller.signal }),
      timeout,
    ]);
  } catch (error: unknown) {
    throw error instanceof AiFailure
      ? error
      : new AiFailure(controller.signal.aborted ? 'timeout' : 'unavailable');
  } finally {
    clearTimeout(timer);
  }
}
