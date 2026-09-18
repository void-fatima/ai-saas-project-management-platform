import { act, renderHook, waitFor } from '@testing-library/react';
import { useWorkspaces } from './use-workspaces';

const choice = (id: string) => ({ workspace: { id, name: id }, role: 'Viewer' });
const detail = (id: string) => ({
  ...choice(id),
  members: [],
  invitations: [],
  permissions: { rename: false, delete: false, leave: true, assignableRoles: [] },
});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
describe('Authoritative workspace selection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    window.history.replaceState(null, '', '/');
  });
  it('rejects stale preferences against the server list and selects a current membership', async () => {
    window.history.replaceState(null, '', '/?workspace=removed');
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ workspaces: [choice('allowed')] }))
      .mockResolvedValueOnce(json(detail('allowed')));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(useWorkspaces);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.detail?.workspace.id).toBe('allowed');
    expect(result.current.error).toContain('no longer available');
    expect(
      fetchMock.mock.calls.some(([url]) => typeof url === 'string' && url.endsWith('/removed')),
    ).toBe(false);
  });
  it.each([403, 404, 503])('clears scoped content and distinguishes failure %i', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json({ workspaces: [choice('a')] }))
        .mockResolvedValueOnce(json({}, status)),
    );
    const { result } = renderHook(useWorkspaces);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.detail).toBeNull();
    expect(result.current.error).toContain(
      status === 403 ? 'role' : status === 404 ? 'no longer' : 'temporarily',
    );
  });
  it('ignores an older tenant response when switching', async () => {
    let finish: (value: Response) => void = () => {
      throw new Error('Uninitialized');
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(json({ workspaces: [choice('a'), choice('b')] }))
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        )
        .mockResolvedValueOnce(json({ workspaces: [choice('a'), choice('b')] }))
        .mockResolvedValueOnce(json(detail('b'))),
    );
    const { result } = renderHook(useWorkspaces);
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBe(2));
    await act(async () => {
      await result.current.load('b');
    });
    await act(async () => {
      finish(json(detail('a')));
      await Promise.resolve();
    });
    expect(result.current.detail?.workspace.id).toBe('b');
  });
  it('bounds stalled workspace loads and exposes retry', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
          }),
      ),
    );
    const { result } = renderHook(useWorkspaces);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toContain('temporarily');
  });
});
