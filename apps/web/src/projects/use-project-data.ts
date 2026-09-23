import { useCallback, useEffect, useRef, useState } from 'react';

export function useProjectData<T>(read: (signal: AbortSignal) => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const isMounted = useCallback(() => mounted.current, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const reload = useCallback(async () => {
    if (!mounted.current) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    setData(null);
    setError('');
    try {
      const result = await read(controller.signal);
      if (active.current === controller) setData(result);
    } catch (failure: unknown) {
      if (active.current === controller)
        setError(failure instanceof Error ? failure.message : 'Unable to load. Please retry.');
    } finally {
      if (active.current === controller) {
        setLoading(false);
        active.current = null;
      }
    }
  }, [read]);
  useEffect(() => {
    void reload();
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [reload]);
  return { data, error, loading, reload, isMounted };
}
