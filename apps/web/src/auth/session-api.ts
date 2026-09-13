import { apiUrl } from '../api/config';
import { isAuthResponse, type AuthResponse } from './auth-api';

export type SessionUser = AuthResponse['user'];

export class SessionApiError extends Error {
  constructor(readonly status: number) {
    super(
      status === 401
        ? 'Please sign in again.'
        : status === 403
          ? 'You do not have permission to perform this action.'
          : status === 429
            ? 'Too many requests. Wait a minute before trying again.'
            : 'The service is temporarily unavailable. Please retry.',
    );
  }
}

async function requestSession(path: string, method: 'GET' | 'POST', signal: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(`${apiUrl}/auth/${path}`, {
      method,
      credentials: 'include',
      cache: 'no-store',
      signal,
    });
  } catch {
    throw new SessionApiError(0);
  }
  if (!response.ok) throw new SessionApiError(response.status);
  return response;
}

export async function restoreSession(signal: AbortSignal): Promise<SessionUser> {
  const response = await requestSession('me', 'GET', signal);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new SessionApiError(0);
  }
  if (!isAuthResponse(body)) throw new SessionApiError(0);
  return body.user;
}

export async function endSession(all: boolean, signal: AbortSignal): Promise<void> {
  await requestSession(all ? 'logout-all' : 'logout', 'POST', signal);
}
