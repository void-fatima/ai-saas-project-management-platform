import { apiUrl } from '../api/config';
import { WorkspaceError, workspaceRequest } from '../workspaces/workspace-api';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function object(value: unknown) {
  if (!isRecord(value)) throw new Error('Invalid report response.');
  return value;
}
function text(value: unknown) {
  if (typeof value !== 'string') throw new Error('Invalid report text.');
  return value;
}
function number(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new Error('Invalid report count.');
  return value;
}
function boolean(value: unknown) {
  if (typeof value !== 'boolean') throw new Error('Invalid report flag.');
  return value;
}
function list<T>(value: unknown, parse: (item: unknown) => T) {
  if (!Array.isArray(value) || value.length > 100) throw new Error('Invalid report list.');
  return value.map(parse);
}
function counts(value: unknown) {
  const row = object(value);
  return {
    total: number(row.total),
    TODO: number(row.TODO),
    IN_PROGRESS: number(row.IN_PROGRESS),
    DONE: number(row.DONE),
    completionPercent: number(row.completionPercent),
  };
}
export function parseReport(value: unknown) {
  const data = object(value);
  const projects = object(data.projects);
  const page = object(data.page);
  const project = data.project === null ? null : object(data.project);
  return {
    workspaceId: text(data.workspaceId),
    range: text(data.range),
    generatedAt: text(data.generatedAt),
    project: project
      ? {
          id: text(project.id),
          name: text(project.name),
          description: text(project.description),
          archived: boolean(project.archived),
        }
      : null,
    projects: {
      total: number(projects.total),
      active: number(projects.active),
      archived: number(projects.archived),
      items: list(projects.items, (item) => {
        const p = object(item);
        return { id: text(p.id), name: text(p.name), archived: boolean(p.archived) };
      }),
    },
    tasks: counts(data.tasks),
    subtasks: counts(data.subtasks),
    workload: list(data.workload, (item) => {
      const row = object(item);
      return {
        userId: row.userId === null ? null : text(row.userId),
        name: text(row.name),
        tasks: number(row.tasks),
        subtasks: number(row.subtasks),
        open: number(row.open),
        done: number(row.done),
      };
    }),
    trend: list(data.trend, (item) => {
      const row = object(item);
      return {
        day: text(row.day),
        created: number(row.created),
        completed: number(row.completed),
        activity: number(row.activity),
      };
    }),
    page: {
      offset: number(page.offset),
      nextOffset: page.nextOffset === null ? null : number(page.nextOffset),
    },
    canAudit: boolean(object(data.permissions).audit),
  };
}
export function parseAudit(value: unknown) {
  const data = object(value);
  return {
    nextCursor: data.nextCursor === null ? null : text(data.nextCursor),
    items: list(data.items, (item) => {
      const row = object(item);
      const metadata = object(row.metadata);
      const details = Object.entries(metadata).map(([key, value]) => {
        if (
          value !== null &&
          typeof value !== 'string' &&
          typeof value !== 'number' &&
          !(Array.isArray(value) && value.every((part: unknown) => typeof part === 'string'))
        )
          throw new Error('Invalid audit metadata.');
        return `${key}: ${JSON.stringify(value)}`;
      });
      return {
        id: text(row.id),
        actorUserId: row.actorUserId === null ? null : text(row.actorUserId),
        action: text(row.action),
        entityType: text(row.entityType),
        entityId: text(row.entityId),
        createdAt: text(row.createdAt),
        details,
      };
    }),
  };
}
export async function reportingRequest(path: string, signal: AbortSignal) {
  try {
    return await workspaceRequest(
      path,
      'GET',
      undefined,
      AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    );
  } catch (error: unknown) {
    const status = error instanceof WorkspaceError ? error.status : 0;
    throw new Error(
      status === 400
        ? 'Check the filters and choose a date range of at most 90 days.'
        : status === 401
          ? 'Please sign in again.'
          : status === 403
            ? 'Your current role does not permit this report or audit view.'
            : status === 404
              ? 'This workspace or project is no longer available.'
              : status === 429
                ? 'Too many requests. Wait before retrying.'
                : 'Unable to load analytics and reports. Please retry.',
    );
  }
}
export async function downloadReport(path: string, filename: string, signal: AbortSignal) {
  const response = await fetch(`${apiUrl}/workspaces${path}`, {
    credentials: 'include',
    cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
  });
  if (!response.ok) throw new WorkspaceError(response.status);
  if (!response.headers.get('content-type')?.startsWith('text/csv'))
    throw new Error('Invalid export response.');
  const blob = await response.blob();
  if (signal.aborted) return;
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
export type Report = ReturnType<typeof parseReport>;
