import { useCallback, useState } from 'react';
import { BellIcon } from '../components/icons';
import { useModalDialog } from '../components/use-modal-dialog';
import { Button } from '../components/ui/Button';
import {
  activityLink,
  activityText,
  collaborationRequest,
  parseNotifications,
} from './collaboration-api';
import { useCollaborationData } from './use-collaboration-data';
import { refreshCollaboration, useRealtime } from './use-realtime';

export function Notifications({ onSessionEnded }: { onSessionEnded: () => void }) {
  const realtime = useRealtime(onSessionEnded);
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const read = useCallback(
    async (signal: AbortSignal) =>
      parseNotifications(
        await collaborationRequest(`/notifications?offset=${offset}`, 'GET', undefined, signal),
      ),
    [offset],
  );
  const state = useCollaborationData(undefined, read);
  const dialog = useModalDialog(open);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function mark(id?: string) {
    setPending(true);
    setError('');
    try {
      await collaborationRequest(
        id ? `/notifications/${id}/read` : '/notifications/read-all',
        id ? 'PATCH' : 'POST',
      );
      refreshCollaboration();
      await state.refresh();
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Unable to mark read.');
    } finally {
      setPending(false);
    }
  }
  const count = state.data?.unreadCount;
  return (
    <>
      <Button
        className="notification-trigger"
        variant="ghost"
        aria-label={`Notifications${count === undefined ? '' : `, ${count} unread`}`}
        onClick={() => {
          setOpen(true);
          void state.refresh();
        }}
      >
        <BellIcon size={19} />
        <span>{count === undefined ? 'Notifications' : `${count} unread`}</span>
      </Button>
      {open ? (
        <dialog
          ref={dialog}
          className="workspace-dialog notification-dialog"
          aria-label="Notifications"
          onCancel={(event) => {
            event.preventDefault();
            setOpen(false);
          }}
        >
          <header className="project-toolbar">
            <h2>Notifications</h2>
            <Button onClick={() => setOpen(false)}>Close notifications</Button>
          </header>
          <p>
            {realtime.status === 'live'
              ? 'Live updates connected.'
              : 'Live updates unavailable or reconnecting. You can keep working and refresh manually.'}
          </p>
          <Button variant="ghost" onClick={realtime.retry}>
            Refresh and reconnect
          </Button>
          {state.error || error ? <p role="alert">{error || state.error}</p> : null}
          {state.loading && !state.data ? <p>Loading notifications…</p> : null}
          <p aria-live="polite">
            {count === undefined ? 'Unread count unavailable.' : `${count} unread notifications`}
          </p>
          <Button disabled={pending || !count} onClick={() => void mark()}>
            Mark all read
          </Button>
          {state.data?.items.length === 0 ? <p>No notifications yet.</p> : null}
          <ol className="collaboration-list">
            {state.data?.items.map((n) => (
              <li key={n.id}>
                <p>
                  {n.readAt ? 'Read' : 'Unread'} ·{' '}
                  {n.type === 'ASSIGNED' ? 'Task assigned to you' : 'New comment'}
                </p>
                <a href={activityLink(n.activity)}>{activityText(n.activity)}</a>
                <p>
                  <time dateTime={n.activity.createdAt}>
                    {new Date(n.activity.createdAt).toLocaleString()}
                  </time>
                </p>
                {!n.readAt ? (
                  <Button variant="ghost" disabled={pending} onClick={() => void mark(n.id)}>
                    Mark read
                  </Button>
                ) : null}
              </li>
            ))}
          </ol>
          <div className="project-toolbar">
            {offset > 0 ? (
              <Button onClick={() => setOffset(Math.max(0, offset - 50))}>
                Newer notifications
              </Button>
            ) : null}
            {state.data?.nextOffset != null ? (
              <Button onClick={() => setOffset(state.data?.nextOffset ?? 0)}>
                Older notifications
              </Button>
            ) : null}
          </div>
        </dialog>
      ) : null}
    </>
  );
}
