import { useEffect, useRef, useState } from 'react';
import { apiUrl } from '../api/config';

// Local invalidation bus: hints never carry durable domain state or authorization.
const updates = new EventTarget();
export function refreshCollaboration(workspaceId?: string) {
  updates.dispatchEvent(new CustomEvent('refresh', { detail: workspaceId }));
}
export function useCollaborationUpdates(workspaceId: string | undefined, refresh: () => void) {
  const callback = useRef(refresh);
  useEffect(() => {
    callback.current = refresh;
  }, [refresh]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const receive = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      if (workspaceId && event.detail && event.detail !== workspaceId) return;
      clearTimeout(timer);
      timer = setTimeout(() => callback.current(), 150);
    };
    updates.addEventListener('refresh', receive);
    return () => {
      clearTimeout(timer);
      updates.removeEventListener('refresh', receive);
    };
  }, [workspaceId]);
}
export function useRealtime(onSessionEnded: () => void) {
  const callback = useRef(onSessionEnded);
  useEffect(() => {
    callback.current = onSessionEnded;
  }, [onSessionEnded]);
  const [status, setStatus] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (typeof EventSource === 'undefined') {
      setStatus('offline');
      return;
    }
    setStatus('connecting');
    const source = new EventSource(`${apiUrl}/realtime`, { withCredentials: true });
    source.addEventListener('ready', () => {
      setStatus('live');
      refreshCollaboration();
    });
    const changed = (event: MessageEvent<string>) => {
      try {
        const data: unknown = JSON.parse(event.data);
        if (
          typeof data === 'object' &&
          data !== null &&
          'workspaceId' in data &&
          typeof data.workspaceId === 'string'
        )
          refreshCollaboration(data.workspaceId);
      } catch {
        setStatus('offline');
      }
    };
    source.addEventListener('workspace-changed', changed);
    source.addEventListener('workspace-access-ended', changed);
    source.addEventListener('notifications-changed', () => refreshCollaboration());
    source.addEventListener('session-ended', () => {
      source.close();
      setStatus('offline');
      callback.current();
    });
    source.onerror = () => {
      setStatus('offline');
    }; // Native EventSource retries; ready repairs missed hints.
    const visible = () => {
      if (document.visibilityState === 'visible') refreshCollaboration();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      source.close();
      document.removeEventListener('visibilitychange', visible);
    };
  }, [attempt]);
  return {
    status,
    retry: () => {
      refreshCollaboration();
      setAttempt((value) => value + 1);
    },
  };
}
