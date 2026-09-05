import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import { apiUrl } from '../api/config';
import { AuthView } from './AuthView';
import { fieldGuidance } from './auth-validation';

const publicUser = {
  id: 'f72f1416-9877-4b76-9e6f-6fc0a6859bb3',
  name: 'Taylor Example',
  email: 'taylor@example.com',
  emailVerified: false,
  createdAt: '2026-09-05T09:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fillLogin(password = 'a-valid-password-42'): void {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'taylor@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
}

function openRegistration(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Create an account' }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Taylor Example' } });
  fillLogin();
}

describe('Authentication interface', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('labels and focuses fields, and prevents invalid login submission', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<AuthView onBack={vi.fn()} />);

    expect(screen.getByLabelText('Email')).toHaveFocus();
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
    fireEvent.submit(screen.getByRole('form', { name: 'Login' }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Please check the highlighted fields.');
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(fieldGuidance.email);
    expect(screen.getByLabelText('Email')).toHaveFocus();
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
  });

  it('submits the exact login payload with cookies and accepts a short existing password', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ user: publicUser }));
    const onBack = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<AuthView onBack={onBack} />);

    fillLogin('x');
    fireEvent.submit(screen.getByRole('form', { name: 'Login' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('You’re signed in.'));
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`${apiUrl}/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'taylor@example.com', password: 'x' }),
      signal: fetchMock.mock.calls[0]?.[1]?.signal,
    });
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    await waitFor(() => expect(screen.getByRole('status')).toHaveFocus());
    expect(screen.getByLabelText('Password')).toHaveValue('');
    fireEvent.submit(screen.getByRole('form', { name: 'Login' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Back to overview' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('shows pending feedback and prevents duplicate requests and form switching', async () => {
    let finish: (value: Response) => void = () => {
      throw new Error('Request has not started');
    };
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<AuthView onBack={vi.fn()} />);
    fillLogin();
    const form = screen.getByRole('form', { name: 'Login' });
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Signing in…' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByRole('status')).toHaveTextContent('Signing in…');
    expect(screen.getByLabelText('Email')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Create an account' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back to overview' })).toBeDisabled();

    await act(async () => {
      finish(jsonResponse({ user: publicUser }));
      await Promise.resolve();
    });
    expect(screen.getByRole('status')).toHaveTextContent('You’re signed in.');
  });

  it('shows a safe invalid-credentials message and allows a retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'internal-sensitive-detail' }, 401))
      .mockResolvedValueOnce(jsonResponse({ user: publicUser }));
    vi.stubGlobal('fetch', fetchMock);
    render(<AuthView onBack={vi.fn()} />);
    fillLogin();
    fireEvent.submit(screen.getByRole('form', { name: 'Login' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
    expect(screen.queryByText(/internal-sensitive-detail/)).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    fireEvent.submit(screen.getByRole('form', { name: 'Login' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('You’re signed in.'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('validates registration fields and resets form errors and passwords when switching views', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<AuthView onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    expect(screen.getByLabelText('Name')).toHaveFocus();
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'invalid' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Register' }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription(fieldGuidance.name);
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(
      fieldGuidance.registerPassword,
    );
    expect(screen.getByLabelText('Name')).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in instead' }));
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByLabelText('Email')).toHaveFocus();
  });

  it('registers with the exact payload and shows account-created feedback', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ user: publicUser }, 201));
    vi.stubGlobal('fetch', fetchMock);
    render(<AuthView onBack={vi.fn()} />);
    openRegistration();
    fireEvent.submit(screen.getByRole('form', { name: 'Register' }));
    expect(screen.getByRole('button', { name: 'Creating account…' })).toBeDisabled();

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Your account has been created.'),
    );
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`${apiUrl}/auth/register`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Taylor Example',
        email: 'taylor@example.com',
        password: 'a-valid-password-42',
      }),
      signal: fetchMock.mock.calls[0]?.[1]?.signal,
    });
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.queryByText(/verified/i)).not.toBeInTheDocument();
  });

  it('handles a duplicate registration without disclosing account existence or internal errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ message: 'users_email_key' }, 409)),
    );
    render(<AuthView onBack={vi.fn()} />);
    openRegistration();
    fireEvent.submit(screen.getByRole('form', { name: 'Register' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to create an account with these details. Try signing in instead.',
    );
    expect(screen.queryByText(/users_email_key/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in instead' }));
    expect(screen.getByRole('form', { name: 'Login' })).toBeInTheDocument();
  });

  it('maps API validation paths to safe accessible field feedback', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            code: 'VALIDATION_FAILED',
            errors: [
              { path: 'email', message: 'internal-sensitive-detail' },
              { path: 'unknown', message: 'internal-sensitive-detail' },
              null,
            ],
          },
          400,
        ),
      ),
    );
    render(<AuthView onBack={vi.fn()} />);
    fillLogin();
    fireEvent.submit(screen.getByRole('form', { name: 'Login' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please check your details and try again.',
    );
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(fieldGuidance.email);
    expect(screen.getByLabelText('Email')).toHaveFocus();
    expect(screen.queryByText(/internal-sensitive-detail/)).not.toBeInTheDocument();
  });

  it.each([
    [429, 'Too many attempts. Wait a minute before trying again.'],
    [503, 'We could not complete your request. Please try again later.'],
  ])('handles a non-JSON %i response safely', async (status, message) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('internal-sensitive-detail', { status })),
    );
    render(<AuthView onBack={vi.fn()} />);
    fillLogin();
    fireEvent.submit(screen.getByRole('form', { name: 'Login' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByText(/internal-sensitive-detail/)).not.toBeInTheDocument();
  });

  it('reports network failures and malformed success responses without exposing their contents', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValueOnce(new Error('internal-sensitive-detail'))
        .mockResolvedValueOnce(jsonResponse({ token: 'internal-sensitive-detail' })),
    );
    render(<AuthView onBack={vi.fn()} />);
    fillLogin();
    fireEvent.submit(screen.getByRole('form', { name: 'Login' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to connect.');
    fireEvent.submit(screen.getByRole('form', { name: 'Login' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('We could not confirm the response.'),
    );
    expect(screen.queryByText(/internal-sensitive-detail/)).not.toBeInTheDocument();
  });

  it('times out stalled requests and re-enables submission', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      ),
    );
    render(<AuthView onBack={vi.fn()} />);
    fillLogin();
    fireEvent.submit(screen.getByRole('form', { name: 'Login' }));
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The request took too long. Please try again.',
    );
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('aborts an in-flight request when the view unmounts', () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = render(<AuthView onBack={vi.fn()} />);
    fillLogin();
    fireEvent.submit(screen.getByRole('form', { name: 'Login' }));
    const signal = fetchMock.mock.calls[0]?.[1].signal;
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
