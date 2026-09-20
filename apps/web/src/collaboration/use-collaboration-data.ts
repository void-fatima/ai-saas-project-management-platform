import { useCallback, useEffect, useRef, useState } from 'react';
import { useCollaborationUpdates } from './use-realtime';

// Keep mounted content and drafts during refresh; reject superseded responses.
export function useCollaborationData<T>(
  workspaceId: string | undefined,
  read: (signal: AbortSignal) => Promise<T>,
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const active = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    setError('');
    try {
      const value = await read(controller.signal);
      if (active.current === controller) setData(value);
    } catch (error: unknown) {
      if (active.current === controller) {
        setData(null);
        setError(error instanceof Error ? error.message : 'Unable to load collaboration.');
      }
    } finally {
      if (active.current === controller) {
        setLoading(false);
        active.current = null;
      }
    }
  }, [read]);
  useEffect(() => {
    void refresh();
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [refresh]);
  useCollaborationUpdates(workspaceId, () => void refresh());
  return { data, error, loading, refresh };
}
