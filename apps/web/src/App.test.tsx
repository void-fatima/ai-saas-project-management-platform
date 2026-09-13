import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import { App } from './App';

const user = {
  id: 'test-user',
  name: 'Taylor Example',
  email: 'taylor@example.com',
  emailVerified: false,
  createdAt: '2026-09-01T00:00:00.000Z',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function requestUrl(url: RequestInfo | URL): string {
  return typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
}

function setupAuthenticated() {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementation((url) =>
      Promise.resolve(
        requestUrl(url).endsWith('/auth/me') ? json({ user }) : json({ status: 'ok' }),
      ),
    );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function shell() {
  await screen.findByRole('heading', { name: 'AI System Observatory' });
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('available'));
}

describe('Authenticated application', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('does not flash protected content before cookie-based bootstrap completes', async () => {
    let finish: (response: Response) => void = () => {
      throw new Error('Not initialized');
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(json({ status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    expect(screen.getByRole('status')).toHaveTextContent('Checking your session');
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    await act(async () => {
      finish(json({ user }));
      await Promise.resolve();
    });
    await shell();
    expect(fetchMock.mock.calls[0]?.[0]).toMatch(/\/auth\/me$/);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'include',
      cache: 'no-store',
    });
    expect(screen.getByLabelText('Signed-in account')).toHaveTextContent(user.name);
  });

  it.each(['Login', 'Register'])(
    'enters the protected shell after %s and restores identity on remount',
    async (form) => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(json({}, 401))
        .mockResolvedValueOnce(json({ user }, form === 'Register' ? 201 : 200))
        .mockImplementation((url) =>
          Promise.resolve(
            requestUrl(url).endsWith('/auth/me') ? json({ user }) : json({ status: 'ok' }),
          ),
        );
      vi.stubGlobal('fetch', fetchMock);
      const view = render(<App />);
      await screen.findByRole('form', { name: 'Login' });
      if (form === 'Register') {
        fireEvent.click(screen.getByRole('button', { name: 'Create an account' }));
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: user.name } });
      }
      fireEvent.change(screen.getByLabelText('Email'), { target: { value: user.email } });
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'valid-password-42' },
      });
      fireEvent.submit(screen.getByRole('form', { name: form }));
      await shell();
      view.unmount();
      render(<App />);
      await shell();
      expect(
        fetchMock.mock.calls.filter(([url]) => requestUrl(url).endsWith('/auth/me')),
      ).toHaveLength(2);
    },
  );

  it.each(['Sign out', 'Sign out all devices'])(
    'removes protected content after %s',
    async (label) => {
      const fetchMock = setupAuthenticated();
      render(<App />);
      await shell();
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      fireEvent.click(screen.getByRole('button', { name: label }));
      await screen.findByRole('form', { name: 'Login' });
      expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
      expect(screen.queryByText(user.name)).not.toBeInTheDocument();
      expect(fetchMock.mock.calls.at(-1)?.[0]).toMatch(
        label === 'Sign out' ? /\/auth\/logout$/ : /\/auth\/logout-all$/,
      );
    },
  );

  it.each([403, 429, 503, 0])(
    'preserves identity on logout failure %i and offers recovery',
    async (status) => {
      const fetchMock = setupAuthenticated();
      render(<App />);
      await shell();
      if (status) fetchMock.mockResolvedValueOnce(json({}, status));
      else fetchMock.mockRejectedValueOnce(new TypeError('Network unavailable'));
      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(
        status === 403 ? /permission/ : status === 429 ? /Too many/ : /temporarily unavailable/,
      );
      expect(screen.getByLabelText('Signed-in account')).toHaveTextContent(user.name);
      expect(screen.queryByRole('form', { name: 'Login' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Retry session check' }));
      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    },
  );

  it('changes auth state only on a genuine 401 from an authenticated request', async () => {
    const fetchMock = setupAuthenticated();
    render(<App />);
    await shell();
    fetchMock.mockResolvedValueOnce(json({}, 401));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('form', { name: 'Login' });
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('keeps a failed bootstrap separate from unauthenticated state and retries without a loop', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json({}, 401));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findByRole('alert');
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry session check' }));
    await screen.findByRole('form', { name: 'Login' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ignores obsolete bootstrap responses after unmount', async () => {
    let finish: (response: Response) => void = () => {
      throw new Error('Not initialized');
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(json({}, 401));
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<App />);
    view.unmount();
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    render(<App />);
    await screen.findByRole('form', { name: 'Login' });
    await act(async () => {
      finish(json({ user }));
      await Promise.resolve();
    });
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('bounds stalled bootstrap requests and exposes retry instead of protected content', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      ),
    );
    render(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('temporarily unavailable');
    expect(screen.getByRole('button', { name: 'Retry session check' })).toBeEnabled();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('revalidates identity when returning to the tab after another device revokes it', async () => {
    const fetchMock = setupAuthenticated();
    render(<App />);
    await shell();
    fetchMock.mockResolvedValueOnce(json({}, 401));
    fireEvent.focus(window);
    await screen.findByRole('form', { name: 'Login' });
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('keeps existing shell commands and developer panel available after bootstrap', async () => {
    setupAuthenticated();
    render(<App />);
    await shell();
    fireEvent.keyDown(window, { ctrlKey: true, key: 'k' });
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const core = screen.getByRole('button', { name: 'Interactive AI Core' });
    for (let click = 0; click < 5; click += 1) fireEvent.click(core);
    expect(screen.getByRole('dialog', { name: 'Developer system panel' })).toBeInTheDocument();
  });
});
