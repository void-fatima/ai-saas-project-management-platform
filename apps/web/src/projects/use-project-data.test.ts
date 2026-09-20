import { act, renderHook, waitFor } from '@testing-library/react';
import { useProjectData } from './use-project-data';

it('cancels superseded reads and ignores a late response from the old resource', async () => {
  let finish: (value: string) => void = () => {
    throw new Error('Read not started');
  };
  let oldSignal: AbortSignal | undefined;
  const first = (signal: AbortSignal) => {
    oldSignal = signal;
    return new Promise<string>((resolve) => {
      finish = resolve;
    });
  };
  const second = () => Promise.resolve('New project');
  const hook = renderHook(({ read }) => useProjectData(read), { initialProps: { read: first } });
  hook.rerender({ read: second });
  await waitFor(() => expect(hook.result.current.data).toBe('New project'));
  expect(oldSignal?.aborted).toBe(true);
  await act(async () => {
    finish('Old tenant content');
    await Promise.resolve();
  });
  expect(hook.result.current.data).toBe('New project');
});

it('clears previously visible content when a subsequent request loses access', async () => {
  const read = vi
    .fn<() => Promise<string>>()
    .mockResolvedValueOnce('Private board')
    .mockRejectedValueOnce(new Error('No longer available'));
  const hook = renderHook(() => useProjectData(read));
  await waitFor(() => expect(hook.result.current.data).toBe('Private board'));
  await act(async () => {
    await hook.result.current.reload();
  });
  expect(hook.result.current.data).toBeNull();
  expect(hook.result.current.error).toBe('No longer available');
  expect(hook.result.current.loading).toBe(false);
});
