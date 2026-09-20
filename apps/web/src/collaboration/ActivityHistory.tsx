import { useCallback, useState } from 'react';
import { Button } from '../components/ui/Button';
import { parsePage } from '../projects/project-api';
import { activityText, collaborationRequest, parseActivity } from './collaboration-api';
import { useCollaborationData } from './use-collaboration-data';

export function ActivityHistory({
  workspaceId,
  projectId,
  taskId,
}: {
  workspaceId: string;
  projectId: string;
  taskId?: string;
}) {
  const [offset, setOffset] = useState(0);
  const read = useCallback(
    async (signal: AbortSignal) => {
      const query = new URLSearchParams({ projectId, offset: String(offset) });
      if (taskId) query.set('taskId', taskId);
      return parsePage(
        await collaborationRequest(
          `/workspaces/${workspaceId}/activity?${query}`,
          'GET',
          undefined,
          signal,
        ),
        parseActivity,
      );
    },
    [workspaceId, projectId, taskId, offset],
  );
  const state = useCollaborationData(workspaceId, read);
  return (
    <section
      aria-label={taskId ? 'Task activity' : 'Project activity'}
      className="collaboration-section"
    >
      <h3>{taskId ? 'Task activity' : 'Project activity'}</h3>
      <Button
        variant="ghost"
        disabled={state.loading && !state.data}
        onClick={() => void state.refresh()}
      >
        Refresh activity
      </Button>
      {state.loading && !state.data ? <p>Loading activity…</p> : null}
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.data?.items.length === 0 ? <p>No activity yet.</p> : null}
      <ol className="collaboration-list">
        {state.data?.items.map((a) => (
          <li key={a.id}>
            <p>{activityText(a)}</p>
            <time dateTime={a.createdAt}>{new Date(a.createdAt).toLocaleString()}</time>
          </li>
        ))}
      </ol>
      <div className="project-toolbar">
        {offset > 0 ? (
          <Button onClick={() => setOffset(Math.max(0, offset - 50))}>Newer activity</Button>
        ) : null}
        {state.data?.nextOffset != null ? (
          <Button onClick={() => setOffset(state.data?.nextOffset ?? 0)}>Older activity</Button>
        ) : null}
      </div>
    </section>
  );
}
