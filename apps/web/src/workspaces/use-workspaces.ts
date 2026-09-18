import { useCallback, useEffect, useRef, useState } from 'react';
import {
  parseDetail,
  parseWorkspaces,
  WorkspaceError,
  workspaceRequest,
  type WorkspaceChoice,
  type WorkspaceDetail,
} from './workspace-api';

export function useWorkspaces() {
  const [choices, setChoices] = useState<WorkspaceChoice[]>([]);
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const selected = useRef(new URLSearchParams(window.location.search).get('workspace') ?? '');
  const active = useRef<AbortController | null>(null);
  const load = useCallback(async (preferred = selected.current) => {
    selected.current = preferred;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 10_000);
    setLoading(true);
    setError('');
    setDetail(null);
    try {
      const list = parseWorkspaces(await workspaceRequest('', 'GET', undefined, controller.signal));
      const chosen = list.find(({ workspace }) => workspace.id === preferred) ?? list[0];
      const next = chosen
        ? parseDetail(
            await workspaceRequest(`/${chosen.workspace.id}`, 'GET', undefined, controller.signal),
          )
        : null;
      if (active.current !== controller) return;
      setChoices(list);
      setDetail(next);
      selected.current = chosen?.workspace.id ?? '';
      const url = new URL(window.location.href);
      if (selected.current) url.searchParams.set('workspace', selected.current);
      else url.searchParams.delete('workspace');
      window.history.replaceState(null, '', url.pathname + url.search);
      if (preferred && !list.some(({ workspace }) => workspace.id === preferred))
        setError('Your previous workspace is no longer available. Select another or create one.');
    } catch (failure: unknown) {
      if (active.current !== controller) return;
      setError(
        failure instanceof WorkspaceError
          ? failure.message
          : 'Unable to load workspaces. Please retry.',
      );
      setChoices([]);
    } finally {
      window.clearTimeout(timer);
      if (active.current === controller) {
        active.current = null;
        setLoading(false);
      }
    }
  }, []);
  useEffect(() => {
    void load();
    const refresh = () => {
      if (!active.current && document.visibilityState === 'visible') void load();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      active.current?.abort();
      active.current = null;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load]);
  return { choices, detail, loading, error, load };
}
