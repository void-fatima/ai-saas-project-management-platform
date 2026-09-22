import { AiProvider, type AiGeneration, type AiResult } from './ai.provider.js';

// Only selected when NODE_ENV=test; production configuration rejects this provider.
export class TestAiProvider extends AiProvider {
  readonly name = 'test';
  readonly model = 'deterministic-fixture';
  generate(input: AiGeneration): Promise<AiResult> {
    const output =
      input.operation === 'BREAKDOWN'
        ? {
            summary: 'Test suggestion: review before applying.',
            subtasks: [
              {
                title: 'Define acceptance checks',
                description: 'Write observable checks for the parent task.',
              },
              {
                title: 'Validate the completed work',
                description: 'Run the agreed checks and record any gaps.',
              },
            ],
          }
        : input.operation === 'SUMMARY'
          ? {
              summary: 'Test project summary.',
              highlights: ['Review the persisted work.'],
              limitations: ['Deterministic test provider; not a live model.'],
            }
          : {
              summary: 'Test action plan.',
              steps: ['Clarify the expected outcome.', 'Implement and verify the task.'],
              questions: ['What defines completion?'],
            };
    return Promise.resolve({ output, usage: { inputTokens: 100, outputTokens: 80 } });
  }
}
