import { apiUrl } from '../api/config';
import { parsePage } from '../projects/project-api';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function object(value: unknown): Record<string, unknown> {
  if (!isObject(value)) throw new Error('Invalid collaboration response.');
  return value;
}
function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid collaboration response.');
  return value;
}
function nullable(value: unknown) {
  return value === null ? null : string(value);
}
function number(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Invalid collaboration response.');
  return value;
}
function name(value: unknown) {
  return value === null ? 'Former user' : string(object(value).name);
}
export function parseComment(value: unknown) {
  const v = object(value);
  return {
    id: string(v.id),
    authorUserId: nullable(v.authorUserId),
    author: name(v.author),
    body: string(v.body),
    version: number(v.version),
    createdAt: string(v.createdAt),
    updatedAt: string(v.updatedAt),
  };
}
export type Comment = ReturnType<typeof parseComment>;
export function parseComments(value: unknown) {
  const v = object(value);
  if (typeof v.canComment !== 'boolean') throw new Error('Invalid collaboration response.');
  return { ...parsePage(value, parseComment), canComment: v.canComment };
}
export const activityLabels: Record<string, string> = {
  PROJECT_CREATED: 'created project',
  PROJECT_UPDATED: 'updated project',
  PROJECT_ARCHIVED: 'archived project',
  PROJECT_RESTORED: 'restored project',
  PROJECT_DELETED: 'deleted project',
  TASK_CREATED: 'created task',
  TASK_UPDATED: 'updated task',
  TASK_STATUS_CHANGED: 'changed task status',
  TASK_ASSIGNED: 'changed task assignment',
  TASK_DELETED: 'deleted task',
  COMMENT_CREATED: 'commented on',
  COMMENT_UPDATED: 'edited a comment on',
  COMMENT_DELETED: 'deleted a comment on',
};
export function parseActivity(value: unknown) {
  const v = object(value);
  const type = string(v.type);
  if (!Object.hasOwn(activityLabels, type)) throw new Error('Unknown activity type.');
  return {
    id: string(v.id),
    workspaceId: string(v.workspaceId),
    projectId: string(v.projectId),
    taskId: nullable(v.taskId),
    rootTaskId: nullable(v.rootTaskId),
    subject: string(v.subject),
    type,
    actor: name(v.actor),
    createdAt: string(v.createdAt),
  };
}
export function parseNotifications(value: unknown) {
  const v = object(value);
  return {
    ...parsePage(value, (value) => {
      const n = object(value);
      if (n.type !== 'ASSIGNED' && n.type !== 'COMMENT')
        throw new Error('Unknown notification type.');
      return {
        id: string(n.id),
        type: n.type,
        readAt: nullable(n.readAt),
        activity: parseActivity(n.activity),
      };
    }),
    unreadCount: number(v.unreadCount),
  };
}
export function activityText(a: ReturnType<typeof parseActivity>) {
  return `${a.actor} ${activityLabels[a.type]} “${a.subject}”`;
}
export function activityLink(a: ReturnType<typeof parseActivity>) {
  const query = new URLSearchParams({
    view: 'projects',
    workspace: a.workspaceId,
    project: a.projectId,
  });
  if (a.rootTaskId) query.set('task', a.rootTaskId);
  return `/?${query.toString()}`;
}
export async function collaborationRequest(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(10_000);
  let res: Response;
  try {
    res = await fetch(`${apiUrl}${path}`, {
      method,
      credentials: 'include',
      cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Collaboration is temporarily unavailable. Please retry.');
  }
  if (!res.ok)
    throw new Error(
      res.status === 401
        ? 'Please sign in again.'
        : res.status === 403
          ? 'Your current role does not permit this action.'
          : res.status === 404
            ? 'This workspace, resource or notification is no longer available.'
            : res.status === 409
              ? 'The content changed or the project is archived. Refresh and review before retrying.'
              : res.status === 429
                ? 'Too many requests. Wait a minute and retry.'
                : 'Unable to complete this action. Check your input and retry.',
    );
  return res.status === 204 ? undefined : res.json();
}
