import { act, renderHook, waitFor } from '@testing-library/react';
import { useHealth } from './use-health';

describe('Readiness client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it.each(['<html>proxy</html>', '{"status":"wrong"}', 'null'])(
    'rejects unexpected 200 body %s',
    async (body) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
      const { result } = renderHook(useHealth);
      await waitFor(() => expect(result.current.status).toBe('unavailable'));
    },
  );
  it('cancels and ignores older requests while preserving retry', async () => {
    let finish: (value: Response) => void = () => {
      throw new Error('Not initialized');
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(new Response('{"status":"ok"}'));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(useHealth);
    await act(async () => {
      await result.current.check();
    });
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await act(async () => {
      finish(new Response('bad'));
      await Promise.resolve();
    });
    expect(result.current.status).toBe('available');
  });
  it('times out and aborts stalled probes', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      ),
    );
    const { result } = renderHook(useHealth);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(result.current.status).toBe('unavailable');
  });
});
