import { apiUrl } from '../api/config';
import {
  fieldGuidance,
  type AuthMode,
  type FieldErrors,
  type LoginInput,
  type RegisterInput,
} from './auth-validation';

interface AuthResponse {
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    createdAt: string;
  };
}

export class AuthApiError extends Error {
  constructor(
    message: string,
    readonly fields: FieldErrors = {},
  ) {
    super(message);
    this.name = 'AuthApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAuthResponse(value: unknown): value is AuthResponse {
  if (!isRecord(value) || !isRecord(value.user)) return false;
  const user = value.user;
  return (
    typeof user.id === 'string' &&
    typeof user.name === 'string' &&
    typeof user.email === 'string' &&
    typeof user.emailVerified === 'boolean' &&
    typeof user.createdAt === 'string'
  );
}

function validationFields(body: unknown, mode: AuthMode): FieldErrors {
  const fields: FieldErrors = {};
  if (!isRecord(body) || body.code !== 'VALIDATION_FAILED' || !Array.isArray(body.errors)) {
    return fields;
  }

  // Only known field paths are used. Server messages never enter the interface.
  for (const issue of body.errors) {
    if (!isRecord(issue)) continue;
    if (issue.path === 'email') fields.email = fieldGuidance.email;
    if (issue.path === 'name' && mode === 'register') fields.name = fieldGuidance.name;
    if (issue.path === 'password') {
      fields.password =
        mode === 'register' ? fieldGuidance.registerPassword : fieldGuidance.loginPassword;
    }
  }
  return fields;
}

async function submitAuth(
  mode: AuthMode,
  input: LoginInput | RegisterInput,
  signal: AbortSignal,
): Promise<AuthResponse> {
  let response: Response;
  let body: unknown;
  try {
    response = await fetch(`${apiUrl}/auth/${mode}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    });
    // Read as text so non-JSON gateway errors still receive safe status-based feedback.
    const text = await response.text();
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  } catch {
    throw new AuthApiError(
      signal.aborted
        ? 'The request took too long. Please try again.'
        : 'Unable to connect. Check your connection and try again.',
    );
  }

  if (!response.ok) {
    switch (response.status) {
      case 400:
        throw new AuthApiError(
          'Please check your details and try again.',
          validationFields(body, mode),
        );
      case 401:
        throw new AuthApiError('Invalid email or password.');
      case 409:
        throw new AuthApiError(
          'Unable to create an account with these details. Try signing in instead.',
        );
      case 429:
        throw new AuthApiError('Too many attempts. Wait a minute before trying again.');
      default:
        throw new AuthApiError('We could not complete your request. Please try again later.');
    }
  }

  if (!isAuthResponse(body)) {
    throw new AuthApiError('We could not confirm the response. Please try signing in again.');
  }
  return body;
}

export function login(input: LoginInput, signal: AbortSignal): Promise<AuthResponse> {
  return submitAuth('login', { email: input.email, password: input.password }, signal);
}

export function register(input: RegisterInput, signal: AbortSignal): Promise<AuthResponse> {
  return submitAuth(
    'register',
    { name: input.name, email: input.email, password: input.password },
    signal,
  );
}
