import { parseActivity } from '../collaboration/collaboration-api';
import { parsePage, parseStatus } from '../projects/project-api';
import { WorkspaceError, workspaceRequest } from '../workspaces/workspace-api';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function object(value: unknown): Record<string, unknown> {
  if (!isObject(value)) throw new WorkspaceError(0);
  return value;
}
function text(value: unknown) {
  if (typeof value !== 'string') throw new WorkspaceError(0);
  return value;
}
function count(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new WorkspaceError(0);
  return value;
}
function list<T>(value: unknown, parse: (item: unknown) => T) {
  if (!Array.isArray(value) || value.length > 8) throw new WorkspaceError(0);
  return value.map(parse);
}
function counts(value: unknown) {
  const row = object(value);
  return {
    total: count(row.total),
    TODO: count(row.TODO),
    IN_PROGRESS: count(row.IN_PROGRESS),
    DONE: count(row.DONE),
  };
}
function task(value: unknown) {
  const row = object(value);
  return {
    id: text(row.id),
    projectId: text(row.projectId),
    parentId: row.parentId === null ? null : text(row.parentId),
    title: text(row.title),
    status: parseStatus(row.status),
    updatedAt: text(row.updatedAt),
  };
}
export function parseDashboard(value: unknown) {
  const row = object(value),
    projects = object(row.projects),
    assigned = object(row.assignedToMe);
  return {
    workspaceId: text(row.workspaceId),
    projects: {
      total: count(projects.total),
      active: count(projects.active),
      archived: count(projects.archived),
    },
    tasks: counts(row.tasks),
    subtasks: counts(row.subtasks),
    assignedToMe: { total: count(assigned.total), items: list(assigned.items, task) },
    recentTasks: list(row.recentTasks, task),
    activity: list(row.activity, parseActivity),
  };
}
export interface SearchResult {
  kind: 'PROJECT' | 'TASK' | 'SUBTASK';
  id: string;
  projectId: string;
  parentId: string | null;
  title: string;
  snippet: string;
  status: ReturnType<typeof parseStatus> | null;
  archived: boolean;
  updatedAt: string;
}
export function parseSearch(value: unknown) {
  return parsePage<SearchResult>(value, (value) => {
    const row = object(value);
    const kind = row.kind;
    if (
      (kind !== 'PROJECT' && kind !== 'TASK' && kind !== 'SUBTASK') ||
      typeof row.archived !== 'boolean'
    )
      throw new WorkspaceError(0);
    return {
      kind,
      id: text(row.id),
      projectId: text(row.projectId),
      parentId: row.parentId === null ? null : text(row.parentId),
      title: text(row.title),
      snippet: text(row.snippet),
      status: row.status === null ? null : parseStatus(row.status),
      archived: row.archived,
      updatedAt: text(row.updatedAt),
    };
  });
}
export function resourceLink(
  workspaceId: string,
  item: { id: string; projectId: string; parentId: string | null; kind?: string },
) {
  const query = new URLSearchParams({
    view: 'projects',
    workspace: workspaceId,
    project: item.projectId,
  });
  if (item.kind !== 'PROJECT') query.set('task', item.parentId ?? item.id);
  if (item.parentId) query.set('subtask', item.id);
  return `/?${query.toString()}`;
}
export const discoveryRequest = (path: string, signal: AbortSignal) =>
  workspaceRequest(path, 'GET', undefined, AbortSignal.any([signal, AbortSignal.timeout(10_000)]));
