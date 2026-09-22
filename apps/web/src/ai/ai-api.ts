import { WorkspaceError, workspaceRequest } from '../workspaces/workspace-api';

export type Operation = 'summary' | 'breakdown' | 'plan';
export interface Draft {
  title: string;
  description: string;
}
export interface Suggestion {
  requestId: string;
  summary: string;
  details: string[];
  notes: string[];
  subtasks: Draft[];
  truncated: boolean;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Invalid AI response.');
  return value;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid AI response.');
  return value;
}
function lines(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 8) throw new Error('Invalid AI response.');
  return value.map(text);
}
export function parseSuggestion(
  value: unknown,
  operation: Operation,
  requestId: string,
): Suggestion {
  const data = record(value);
  const suggestion = record(data.suggestion);
  if (
    data.requestId !== requestId ||
    data.operation !== operation.toUpperCase() ||
    typeof data.contextTruncated !== 'boolean'
  )
    throw new Error('Invalid AI response.');
  let subtasks: Draft[] = [];
  if (operation === 'breakdown') {
    if (
      !Array.isArray(suggestion.subtasks) ||
      suggestion.subtasks.length < 1 ||
      suggestion.subtasks.length > 8
    )
      throw new Error('Invalid AI response.');
    subtasks = suggestion.subtasks.map((item: unknown) => {
      const draft = record(item);
      return { title: text(draft.title), description: text(draft.description) };
    });
  }
  return {
    requestId,
    summary: text(suggestion.summary),
    subtasks,
    truncated: data.contextTruncated,
    details:
      operation === 'summary'
        ? lines(suggestion.highlights)
        : operation === 'plan'
          ? lines(suggestion.steps)
          : [],
    notes:
      operation === 'summary'
        ? lines(suggestion.limitations)
        : operation === 'plan'
          ? lines(suggestion.questions)
          : [],
  };
}
export async function aiRequest(
  path: string,
  body: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  try {
    return await workspaceRequest(
      path,
      'POST',
      body,
      AbortSignal.any([signal, AbortSignal.timeout(35_000)]),
    );
  } catch (error: unknown) {
    const status = error instanceof WorkspaceError ? error.status : 0;
    throw new Error(
      status === 403
        ? 'Your current role does not permit AI assistance.'
        : status === 401
          ? 'Please sign in again.'
          : status === 404
            ? 'This workspace, task or suggestion is no longer available.'
            : status === 409
              ? 'The suggestion is stale, already used, or conflicts with existing subtasks. Review the task and generate a fresh suggestion.'
              : status === 429
                ? 'AI request limit reached. Wait before trying again.'
                : status === 400
                  ? 'Check the subtask titles and descriptions.'
                  : status === 502
                    ? 'AI returned an unusable suggestion. Nothing was applied.'
                    : status === 503
                      ? 'AI assistance is not configured or is temporarily unavailable.'
                      : status === 504
                        ? 'AI assistance timed out. Try again when ready.'
                        : 'Unable to complete the request. For an apply request, retry the same preview to safely check its result.',
    );
  }
}
