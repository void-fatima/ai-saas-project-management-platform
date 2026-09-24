import { useCallback, useState } from 'react';
import { Button } from '../components/ui/Button';
import { useProjectData } from '../projects/use-project-data';
import { parseAudit, reportingRequest } from './reporting-api';

const actions = [
  'WORKSPACE_CREATED',
  'WORKSPACE_UPDATED',
  'WORKSPACE_DELETED',
  'INVITATION_ISSUED',
  'INVITATION_REVOKED',
  'INVITATION_DELIVERY_FAILED',
  'INVITATION_ACCEPTED',
  'MEMBER_ROLE_CHANGED',
  'MEMBER_REMOVED',
  'MEMBER_LEFT',
  'PROJECT_CREATED',
  'PROJECT_UPDATED',
  'PROJECT_ARCHIVED',
  'PROJECT_RESTORED',
  'PROJECT_DELETED',
  'TASK_CREATED',
  'TASK_UPDATED',
  'TASK_STATUS_CHANGED',
  'TASK_ASSIGNED',
  'TASK_REORDERED',
  'TASK_DELETED',
  'AI_BREAKDOWN_APPLIED',
  'COMMENT_CREATED',
  'COMMENT_UPDATED',
  'COMMENT_DELETED',
];
const entities = ['WORKSPACE', 'INVITATION', 'MEMBERSHIP', 'PROJECT', 'TASK', 'SUBTASK', 'COMMENT'];
const label = (value: string) => value.replaceAll('_', ' ').toLowerCase();
export function AuditView({ workspaceId }: { workspaceId: string }) {
  const [filters, setFilters] = useState('');
  const [cursor, setCursor] = useState('');
  const read = useCallback(
    async (signal: AbortSignal) =>
      parseAudit(
        await reportingRequest(
          `/${workspaceId}/audit?${filters}&limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          signal,
        ),
      ),
    [workspaceId, filters, cursor],
  );
  const state = useProjectData(read);
  return (
    <section aria-label="Audit trail" className="report-section page-section">
      <h3>Audit trail</h3>
      <p>
        Immutable workspace history. Actor and entity identifiers remain available after deletion.
        Dates use UTC; the default is the last 30 days.
      </p>
      <form
        aria-label="Audit filters"
        className="project-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const query = new URLSearchParams();
          for (const key of ['action', 'entityType', 'actorUserId', 'from', 'to']) {
            const value = form.get(key);
            if (typeof value === 'string' && value) query.set(key, value);
          }
          setCursor('');
          setFilters(query.toString());
        }}
      >
        <label>
          Audit action
          <select name="action">
            <option value="">All actions</option>
            {actions.map((action) => (
              <option key={action} value={action}>
                {label(action)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Entity type
          <select name="entityType">
            <option value="">All entities</option>
            {entities.map((entity) => (
              <option key={entity}>{entity}</option>
            ))}
          </select>
        </label>
        <label>
          Actor user ID
          <input className="input" name="actorUserId" maxLength={36} />
        </label>
        <label>
          From date
          <input className="input" type="date" name="from" />
        </label>
        <label>
          To date
          <input className="input" type="date" name="to" />
        </label>
        <Button type="submit" disabled={state.loading}>
          Apply audit filters
        </Button>
      </form>
      {state.loading ? <p role="status">Loading audit history…</p> : null}
      {state.error ? <p role="alert">{state.error}</p> : null}
      <Button
        variant="ghost"
        disabled={state.loading}
        onClick={() => {
          setCursor('');
          void state.reload();
        }}
      >
        Refresh audit
      </Button>
      {state.data ? (
        <>
          {!state.data.items.length ? <p>No audit events in this range.</p> : null}
          <ol className="collaboration-list">
            {state.data.items.map((event) => (
              <li key={event.id}>
                <strong>{label(event.action)}</strong> ·{' '}
                <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time>
                <p>
                  Actor: {event.actorUserId ?? 'System'} · {event.entityType}: {event.entityId}
                </p>
                {event.details.map((detail) => (
                  <p key={detail}>{detail}</p>
                ))}
              </li>
            ))}
          </ol>
          {cursor ? <Button onClick={() => setCursor('')}>Newest audit events</Button> : null}
          {state.data.nextCursor ? (
            <Button onClick={() => setCursor(state.data?.nextCursor ?? '')}>
              Older audit events
            </Button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
