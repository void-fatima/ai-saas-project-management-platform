import { useCallback, useEffect, useRef, useState } from 'react';

import { endSession, restoreSession, SessionApiError, type SessionUser } from './session-api';

type SessionState =
  | { status: 'checking'; user: null }
  | { status: 'unauthenticated'; user: null }
  | { status: 'authenticated'; user: SessionUser }
  | { status: 'service-failure'; user: SessionUser | null; message: string };

export function useSession() {
  const [state, setState] = useState<SessionState>({ status: 'checking', user: null });
  const [pending, setPending] = useState(false);
  const active = useRef<AbortController | null>(null);

  const run = useCallback(async (action: 'restore' | 'logout' | 'logout-all') => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 15_000);
    setPending(true);
    try {
      const user = action === 'restore' ? await restoreSession(controller.signal) : null;
      if (action !== 'restore') await endSession(action === 'logout-all', controller.signal);
      if (active.current !== controller) return;
      setState(
        user ? { status: 'authenticated', user } : { status: 'unauthenticated', user: null },
      );
    } catch (error: unknown) {
      if (active.current !== controller) return;
      if (error instanceof SessionApiError && error.status === 401) {
        setState({ status: 'unauthenticated', user: null });
      } else {
        setState((previous) => ({
          status: 'service-failure',
          user: previous.user,
          message: error instanceof Error ? error.message : 'Please retry shortly.',
        }));
      }
    } finally {
      window.clearTimeout(timer);
      if (active.current === controller) {
        active.current = null;
        setPending(false);
      }
    }
  }, []);

  useEffect(() => {
    void run('restore');
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [run]);

  // Revalidate identity after returning to this tab, including logout in another tab.
  useEffect(() => {
    if (!state.user) return;
    const refresh = () => {
      if (!active.current && document.visibilityState === 'visible') void run('restore');
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [run, state.user]);

  const accept = useCallback((user: SessionUser) => {
    active.current?.abort();
    active.current = null;
    setPending(false);
    setState({ status: 'authenticated', user });
  }, []);

  return {
    state,
    pending,
    accept,
    refresh: () => run('restore'),
    logout: (all = false) => run(all ? 'logout-all' : 'logout'),
  };
}
