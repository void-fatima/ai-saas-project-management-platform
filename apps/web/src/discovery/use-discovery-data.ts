import { useCallback, useEffect, useRef, useState } from 'react';

interface State<T> {
  key: string;
  data?: T;
  loading: boolean;
  error?: string;
}

// One in-flight read per scope. Manual refreshes coalesce; a hint during a read queues
// one trailing read to repair changes that might have committed after its snapshot.
export function useDiscoveryData<T>(
  key: string,
  read: (signal: AbortSignal) => Promise<T>,
  delay = 0,
  enabled = true,
) {
  const [state, setState] = useState<State<T>>({ key, loading: enabled });
  const run = useRef<(hint?: boolean) => void>(() => {});
  const reload = useCallback((hint = false) => run.current(hint), []);
  useEffect(() => {
    const controller = new AbortController();
    let running = false,
      dirty = false;
    const load = async (hint = false) => {
      if (running) {
        dirty ||= hint;
        return;
      }
      if (!enabled || controller.signal.aborted) return;
      running = true;
      setState((previous) => ({
        key,
        data: previous.key === key ? previous.data : undefined,
        loading: true,
      }));
      try {
        const data = await read(controller.signal);
        if (!controller.signal.aborted) setState({ key, data, loading: false });
      } catch (error: unknown) {
        if (!controller.signal.aborted)
          setState({
            key,
            loading: false,
            error: error instanceof Error ? error.message : 'Unable to load. Please retry.',
          });
      } finally {
        running = false;
        if (dirty && !controller.signal.aborted) {
          dirty = false;
          void load();
        }
      }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    run.current = (hint) => {
      if (hint && timer !== undefined) return;
      clearTimeout(timer);
      timer = undefined;
      void load(hint);
    };
    setState({ key, loading: enabled });
    if (enabled) {
      if (delay)
        timer = setTimeout(() => {
          timer = undefined;
          void load();
        }, delay);
      else void load();
    }
    return () => {
      controller.abort();
      clearTimeout(timer);
      run.current = () => {};
    };
  }, [key, read, delay, enabled]);
  return { ...(state.key === key ? state : { key, loading: enabled }), reload };
}
