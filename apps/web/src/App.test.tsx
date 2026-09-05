import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import { App } from './App';

describe('App', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens authentication from the shell and restores focus when returning', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('available'));

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByRole('form', { name: 'Login' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    expect(screen.getByRole('form', { name: 'Register' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to overview' }));

    expect(screen.getByRole('button', { name: 'Sign in' })).toHaveFocus();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('available'));
    expect(
      fetchMock.mock.calls.every(([url]) => typeof url === 'string' && url.endsWith('/health')),
    ).toBe(true);
  });

  it('renders the AI observatory and reports a healthy API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    render(<App />);

    expect(screen.getByRole('heading', { name: 'AI System Observatory' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();
    expect(screen.getByRole('timer', { name: /current time in Tehran/i })).toHaveTextContent(
      /Tehran · UTC\+03:30/,
    );
    expect(screen.getByText('Demo data')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('checking');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('available'));
    expect(screen.getByText('Online')).toBeInTheDocument();
  });

  it('allows the API health check to be retried', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Check API connection' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('available'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('opens the command palette with the global keyboard shortcut', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    render(<App />);

    fireEvent.keyDown(window, { ctrlKey: true, key: 'k' });

    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search AI workspace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Agent' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument(),
    );
  });

  it('opens the command palette from the topbar search trigger', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    render(<App />);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('available'));
    fireEvent.click(screen.getByRole('textbox', { name: 'Open AI workspace search' }));

    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
  });

  it('reveals the developer panel after repeated AI Core interaction', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    render(<App />);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('available'));

    const core = screen.getByRole('button', { name: 'Interactive AI Core' });
    for (let click = 0; click < 5; click += 1) fireEvent.click(core);

    expect(screen.getByRole('dialog', { name: 'Developer system panel' })).toBeInTheDocument();
    expect(
      screen.getByText('No production AI services are active in this phase.'),
    ).toBeInTheDocument();
  });
});
