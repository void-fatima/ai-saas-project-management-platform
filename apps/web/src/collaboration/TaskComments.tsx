import { useCallback, useRef, useState } from 'react';
import { Button } from '../components/ui/Button';
import { collaborationRequest, parseComments, type Comment } from './collaboration-api';
import { useCollaborationData } from './use-collaboration-data';
import { refreshCollaboration } from './use-realtime';

export function TaskComments({ base, userId }: { base: string; userId: string }) {
  const workspaceId = base.split('/')[1] ?? '';
  const path = `/workspaces${base}/comments`;
  const [offset, setOffset] = useState(0);
  const read = useCallback(
    async (signal: AbortSignal) =>
      parseComments(
        await collaborationRequest(`${path}?offset=${offset}`, 'GET', undefined, signal),
      ),
    [path, offset],
  );
  const state = useCollaborationData(workspaceId, read);
  const [body, setBody] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Comment | null>(null);
  const [editedBody, setEditedBody] = useState('');
  const request = useRef<{ body: string; id: string } | null>(null);
  async function save(method: string, suffix: string, input: unknown) {
    setPending(true);
    setError('');
    try {
      await collaborationRequest(path + suffix, method, input);
      if (method === 'POST') {
        setBody('');
        request.current = null;
        setOffset(0);
      }
      setEditing(null);
      refreshCollaboration(workspaceId);
      await state.refresh();
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Unable to save comment.');
    } finally {
      setPending(false);
    }
  }
  return (
    <section aria-label="Task comments" className="collaboration-section">
      <h3>Comments</h3>
      <Button
        variant="ghost"
        disabled={pending || (state.loading && !state.data)}
        onClick={() => void state.refresh()}
      >
        Refresh comments
      </Button>
      {state.loading && !state.data ? <p>Loading comments…</p> : null}
      {state.error || error ? <p role="alert">{error || state.error}</p> : null}
      {state.data?.canComment === false ? (
        <p>Comments are read-only for your current role or this archived project.</p>
      ) : null}
      <form
        aria-label="Add comment"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = body.trim();
          if (!trimmed) return;
          if (!request.current || request.current.body !== trimmed)
            request.current = { body: trimmed, id: crypto.randomUUID() };
          void save('POST', '', { body: trimmed, requestId: request.current.id });
        }}
      >
        <label>
          New comment
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={4000}
            rows={3}
            disabled={pending || !state.data?.canComment}
            required
          />
        </label>
        <Button type="submit" disabled={pending || !state.data?.canComment || !body.trim()}>
          Post comment
        </Button>
      </form>
      {editing ? (
        <form
          aria-label="Edit comment"
          onSubmit={(event) => {
            event.preventDefault();
            void save('PATCH', `/${editing.id}`, {
              body: editedBody.trim(),
              version: editing.version,
            });
          }}
        >
          <label>
            Edit comment
            <textarea
              value={editedBody}
              onChange={(event) => setEditedBody(event.target.value)}
              maxLength={4000}
              required
            />
          </label>
          <Button type="submit" disabled={pending || !state.data?.canComment || !editedBody.trim()}>
            Save comment
          </Button>
          <Button variant="ghost" disabled={pending} onClick={() => setEditing(null)}>
            Cancel comment edit
          </Button>
        </form>
      ) : null}
      {state.data?.items.length === 0 ? <p>No comments yet.</p> : null}
      <ol className="collaboration-list">
        {state.data?.items.map((comment) => (
          <li key={comment.id}>
            <article aria-label={`Comment by ${comment.author}`}>
              <header>
                <strong>{comment.author}</strong> ·{' '}
                <time dateTime={comment.createdAt}>
                  {new Date(comment.createdAt).toLocaleString()}
                </time>
                {comment.version > 1 ? ' · edited' : ''}
              </header>
              <p className="project-description">{comment.body}</p>
              {state.data?.canComment && comment.authorUserId === userId ? (
                <div className="project-toolbar">
                  <Button
                    variant="ghost"
                    disabled={pending}
                    onClick={() => {
                      setEditing(comment);
                      setEditedBody(comment.body);
                    }}
                  >
                    Edit comment
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      void save('DELETE', `/${comment.id}`, { version: comment.version })
                    }
                  >
                    Delete comment
                  </Button>
                </div>
              ) : null}
            </article>
          </li>
        ))}
      </ol>
      <div className="project-toolbar">
        {offset > 0 ? (
          <Button onClick={() => setOffset(Math.max(0, offset - 50))}>Newer comments</Button>
        ) : null}
        {state.data?.nextOffset != null ? (
          <Button onClick={() => setOffset(state.data?.nextOffset ?? 0)}>Older comments</Button>
        ) : null}
      </div>
    </section>
  );
}
