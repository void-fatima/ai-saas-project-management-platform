import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TaskComments } from './TaskComments';
import { Notifications } from './Notifications';
import { refreshCollaboration } from './use-realtime';

class TestEventSource extends EventTarget {
  static current: TestEventSource;
  onerror?: () => void;
  close = vi.fn();
  constructor(
    readonly url: string,
    readonly options: EventSourceInit,
  ) {
    super();
    TestEventSource.current = this;
  }
  emit(type: string, data: unknown = {}) {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}
const comment = {
  id: 'comment',
  authorUserId: 'self',
  author: { name: 'Alex' },
  body: '<script>unsafe()</script>',
  version: 1,
  createdAt: '2026-09-20T12:00:00Z',
  updatedAt: '2026-09-20T12:00:00Z',
};
const activity = {
  id: 'activity',
  workspaceId: 'workspace',
  projectId: 'project',
  taskId: 'task',
  rootTaskId: 'task',
  subject: 'Launch',
  type: 'COMMENT_CREATED',
  actor: { name: 'Alex' },
  createdAt: comment.createdAt,
};
function json(value: unknown) {
  return Promise.resolve(new Response(JSON.stringify(value)));
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('renders plain text, keeps a focused draft across hints, and excludes foreign workspace hints', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementation(() => json({ items: [comment], nextOffset: null, canComment: true }));
  vi.stubGlobal('fetch', fetchMock);
  const { container } = render(
    <TaskComments base="/workspace/projects/project/tasks/task" userId="self" />,
  );
  await screen.findByText(comment.body);
  expect(container.querySelector('script')).toBeNull();
  const draft = screen.getByLabelText('New comment');
  draft.focus();
  fireEvent.change(draft, { target: { value: 'Unsent draft' } });
  act(() => refreshCollaboration('workspace'));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(draft).toHaveValue('Unsent draft');
  expect(draft).toHaveFocus();
  act(() => refreshCollaboration('foreign'));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh comments' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
});
it('keeps the request ID on a failed retry and clears a successfully persisted draft', async () => {
  let failed = false;
  const fetchMock = vi.fn<typeof fetch>().mockImplementation((_, init) => {
    if (init?.method === 'POST') {
      if (!failed) {
        failed = true;
        return Promise.resolve(new Response('{}', { status: 503 }));
      }
      return json(comment);
    }
    return json({ items: [], nextOffset: null, canComment: true });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<TaskComments base="/workspace/projects/project/tasks/task" userId="self" />);
  await screen.findByText('No comments yet.');
  fireEvent.change(screen.getByLabelText('New comment'), { target: { value: 'Retry me' } });
  fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('New comment')).toHaveValue('Retry me');
  fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));
  await waitFor(() => expect(screen.getByLabelText('New comment')).toHaveValue(''));
  const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts).toHaveLength(2);
  expect(posts[0]?.[1]?.body).toBe(posts[1]?.[1]?.body);
});
it('keeps Viewer comments readable while disabling creation and author actions', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => json({ items: [comment], nextOffset: null, canComment: false })),
  );
  render(<TaskComments base="/workspace/projects/project/tasks/task" userId="self" />);
  await screen.findByText(comment.body);
  expect(screen.getByRole('button', { name: 'Post comment' })).toBeDisabled();
  expect(screen.getByLabelText('New comment')).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Edit comment' })).toBeNull();
});
it('uses server-returned author identity for own-comment controls and versioned edits', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(() =>
    json({
      items: [comment, { ...comment, id: 'other', authorUserId: 'other' }],
      nextOffset: null,
      canComment: true,
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  render(<TaskComments base="/workspace/projects/project/tasks/task" userId="self" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit comment' }));
  fireEvent.change(screen.getByLabelText('Edit comment', { selector: 'textarea' }), {
    target: { value: 'Edited' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save comment' }));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([, init]) =>
          init?.method === 'PATCH' && init.body === JSON.stringify({ body: 'Edited', version: 1 }),
      ),
    ).toBe(true),
  );
});
it('shows unread state, marks read, navigates safely, and restores dialog focus', async () => {
  let read = false;
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation((_, init) => {
      if (init?.method === 'PATCH') {
        read = true;
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return json({
        items: [
          {
            id: 'notification',
            type: 'COMMENT',
            readAt: read ? comment.createdAt : null,
            activity,
          },
        ],
        nextOffset: null,
        unreadCount: read ? 0 : 1,
      });
    }),
  );
  vi.stubGlobal('EventSource', TestEventSource);
  render(<Notifications onSessionEnded={vi.fn()} />);
  const trigger = await screen.findByRole('button', { name: 'Notifications, 1 unread' });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'Notifications' });
  expect(within(dialog).getByRole('link')).toHaveAttribute(
    'href',
    '/?view=projects&workspace=workspace&project=project&task=task',
  );
  fireEvent.click(within(dialog).getByRole('button', { name: 'Mark read' }));
  await screen.findByText('0 unread notifications');
  fireEvent.click(screen.getByRole('button', { name: 'Close notifications' }));
  expect(trigger).toHaveFocus();
});
it('repairs on reconnect, exposes degraded fallback, and closes invalid sessions and unmounted streams', async () => {
  const fetchMock = vi.fn(() => json({ items: [], nextOffset: null, unreadCount: 0 }));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', TestEventSource);
  const ended = vi.fn();
  const { unmount } = render(<Notifications onSessionEnded={ended} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 0 unread' }));
  const source = TestEventSource.current;
  expect(source.options).toEqual({ withCredentials: true });
  act(() => source.emit('ready'));
  await screen.findByText('Live updates connected.');
  act(() => source.onerror?.());
  await screen.findByText(/Live updates unavailable/);
  const before = fetchMock.mock.calls.length;
  act(() => source.emit('ready'));
  await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
  act(() => source.emit('session-ended'));
  expect(ended).toHaveBeenCalledOnce();
  expect(source.close).toHaveBeenCalled();
  unmount();
  expect(source.close).toHaveBeenCalledTimes(2);
});
