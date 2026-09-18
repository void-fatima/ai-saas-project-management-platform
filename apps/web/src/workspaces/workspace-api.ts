import { apiUrl } from '../api/config';

export type Role = 'Owner' | 'Admin' | 'Manager' | 'Member' | 'Viewer';
export interface Workspace {
  id: string;
  name: string;
}
export interface Membership {
  userId: string;
  role: Role;
  user: { name: string; email: string };
}
export interface Invitation {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
}
export interface WorkspaceDetail {
  workspace: Workspace;
  role: Role;
  members: Membership[];
  invitations: Invitation[];
  permissions: { rename: boolean; delete: boolean; leave: boolean; assignableRoles: Role[] };
}
export interface WorkspaceChoice {
  workspace: Workspace;
  role: Role;
}
export class WorkspaceError extends Error {
  constructor(readonly status: number) {
    super(
      status === 401
        ? 'Please sign in again.'
        : status === 403
          ? 'Your workspace role does not permit this action.'
          : status === 404
            ? 'This workspace or membership is no longer available.'
            : status === 400
              ? 'Check your input. Invitation links may be expired, revoked, used, or intended for another account.'
              : status === 409
                ? 'A membership or invitation conflicts with this action. For a resend, wait one minute.'
                : status === 429
                  ? 'Too many requests. Wait a minute and retry.'
                  : 'The service or email delivery is temporarily unavailable. Please retry.',
    );
  }
}
export async function workspaceRequest(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl}/workspaces${path}`, {
      method,
      credentials: 'include',
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch {
    throw new WorkspaceError(0);
  }
  if (!response.ok) throw new WorkspaceError(response.status);
  if (response.status === 204) return undefined;
  try {
    return await response.json();
  } catch {
    throw new WorkspaceError(0);
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function object(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new WorkspaceError(0);
  return value;
}
function string(value: unknown): string {
  if (typeof value !== 'string') throw new WorkspaceError(0);
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new WorkspaceError(0);
  return value;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new WorkspaceError(0);
  return value;
}
export function parseRole(value: unknown): Role {
  if (
    value === 'Owner' ||
    value === 'Admin' ||
    value === 'Manager' ||
    value === 'Member' ||
    value === 'Viewer'
  )
    return value;
  throw new WorkspaceError(0);
}
export function parseWorkspace(value: unknown): Workspace {
  const data = object(value);
  return { id: string(data.id), name: string(data.name) };
}
export function parseWorkspaces(value: unknown): WorkspaceChoice[] {
  return array(object(value).workspaces).map((entry) => {
    const row = object(entry);
    return { workspace: parseWorkspace(row.workspace), role: parseRole(row.role) };
  });
}
export function parseDetail(value: unknown): WorkspaceDetail {
  const data = object(value);
  const permissions = object(data.permissions);
  return {
    workspace: parseWorkspace(data.workspace),
    role: parseRole(data.role),
    members: array(data.members).map((entry) => {
      const row = object(entry);
      const user = object(row.user);
      return {
        userId: string(row.userId),
        role: parseRole(row.role),
        user: { name: string(user.name), email: string(user.email) },
      };
    }),
    invitations: array(data.invitations).map((entry) => {
      const row = object(entry);
      return {
        id: string(row.id),
        email: string(row.email),
        role: parseRole(row.role),
        expiresAt: string(row.expiresAt),
      };
    }),
    permissions: {
      rename: bool(permissions.rename),
      delete: bool(permissions.delete),
      leave: bool(permissions.leave),
      assignableRoles: array(permissions.assignableRoles).map(parseRole),
    },
  };
}
