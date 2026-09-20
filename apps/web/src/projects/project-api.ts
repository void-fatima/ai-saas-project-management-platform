import { WorkspaceError, workspaceRequest } from '../workspaces/workspace-api';

export const statuses = ['TODO', 'IN_PROGRESS', 'DONE'] as const;
export type Status = (typeof statuses)[number];
export const statusLabels: Record<Status, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  DONE: 'Done',
};
export interface Permissions {
  administer: boolean;
  edit: boolean;
  assignOthers: boolean;
  deleteTasks: boolean;
}
export interface Project {
  id: string;
  name: string;
  description: string;
  archived: boolean;
}
export interface Task {
  id: string;
  title: string;
  description: string;
  status: Status;
  version: number;
  assigneeId: string | null;
  assigneeName: string | null;
  subtasks: number;
}
export interface Assignee {
  userId: string;
  name: string;
  email: string;
}
export interface Page<T> {
  items: T[];
  nextOffset: number | null;
}
export class ProjectError extends Error {
  constructor(readonly status: number) {
    super(
      status === 401
        ? 'Please sign in again.'
        : status === 403
          ? 'Your current role does not permit this action.'
          : status === 404
            ? 'This workspace, project or task is no longer available.'
            : status === 409
              ? 'The task changed or the project is archived. Reloaded the latest state; review it before retrying.'
              : status === 400
                ? 'Check the fields, destination and workspace assignee.'
                : status === 429
                  ? 'Too many requests. Wait a minute and retry.'
                  : 'Unable to reach the project service. Please retry.',
    );
  }
}
export async function projectRequest(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  try {
    return await workspaceRequest(
      path,
      method,
      body,
      signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    );
  } catch (error: unknown) {
    throw new ProjectError(error instanceof WorkspaceError ? error.status : 0);
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function object(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new ProjectError(0);
  return value;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new ProjectError(0);
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new ProjectError(0);
  return value;
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new ProjectError(0);
  return value;
}
export function parseStatus(value: unknown): Status {
  if (value === 'TODO' || value === 'IN_PROGRESS' || value === 'DONE') return value;
  throw new ProjectError(0);
}
export function parseProject(value: unknown): Project {
  const row = object(value);
  return {
    id: text(row.id),
    name: text(row.name),
    description: text(row.description),
    archived: bool(row.archived),
  };
}
export function parsePermissions(value: unknown): Permissions {
  const row = object(value);
  return {
    administer: bool(row.administer),
    edit: bool(row.edit),
    assignOthers: bool(row.assignOthers),
    deleteTasks: bool(row.deleteTasks),
  };
}
export function parseTask(value: unknown): Task {
  const row = object(value);
  return {
    id: text(row.id),
    title: text(row.title),
    description: text(row.description),
    status: parseStatus(row.status),
    version: number(row.version),
    assigneeId: row.assigneeId === null ? null : text(row.assigneeId),
    assigneeName: row.assignee === null ? null : text(object(object(row.assignee).user).name),
    subtasks: number(object(row._count).subtasks),
  };
}
export function parseAssignee(value: unknown): Assignee {
  const row = object(value);
  const user = object(row.user);
  return { userId: text(row.userId), name: text(user.name), email: text(user.email) };
}
export function parsePage<T>(value: unknown, parse: (item: unknown) => T): Page<T> {
  const row = object(value);
  if (!Array.isArray(row.items) || row.items.length > 50) throw new ProjectError(0);
  return {
    items: row.items.map(parse),
    nextOffset: row.nextOffset === null ? null : number(row.nextOffset),
  };
}
export function parseProjects(value: unknown) {
  return {
    ...parsePage(value, parseProject),
    permissions: parsePermissions(object(value).permissions),
  };
}
export function parseProjectDetail(value: unknown) {
  const row = object(value);
  return { project: parseProject(row.project), permissions: parsePermissions(row.permissions) };
}
