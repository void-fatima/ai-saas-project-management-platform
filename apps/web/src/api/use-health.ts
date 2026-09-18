import { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl } from './config';

export function useHealth() {
  const [status, setStatus] = useState<'checking' | 'available' | 'unavailable'>('checking');
  const active = useRef<AbortController | null>(null);
  const check = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 5000);
    setStatus('checking');
    try {
      const response = await fetch(`${apiUrl}/health/ready`, {
        signal: controller.signal,
        cache: 'no-store',
      });
      const body: unknown = await response.json();
      if (active.current !== controller) return;
      const valid =
        response.ok &&
        typeof body === 'object' &&
        body !== null &&
        'status' in body &&
        body.status === 'ok';
      setStatus(valid ? 'available' : 'unavailable');
    } catch {
      if (active.current === controller) setStatus('unavailable');
    } finally {
      window.clearTimeout(timer);
      if (active.current === controller) active.current = null;
    }
  }, []);
  useEffect(() => {
    void check();
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [check]);
  return { status, check };
}
