import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectsPanel } from './ProjectsPanel';
import { TaskEditor } from './TaskEditor';
import { TaskDetails } from './TaskDetails';
import { parsePage, parseTask, type Task } from './project-api';

const project = {
  id: 'project-a',
  name: 'Launch',
  description: 'Ship the first release',
  archived: false,
};
const task = {
  id: 'task-a',
  title: 'Write spec',
  description: '',
  status: 'TODO',
  version: 1,
  assigneeId: null,
  assignee: null,
  _count: { subtasks: 0 },
};
function setup(role: 'Owner' | 'Admin' | 'Manager' | 'Member' | 'Viewer') {
  const administer = ['Owner', 'Admin', 'Manager'].includes(role);
  const permissions = {
    administer,
    edit: role !== 'Viewer',
    deleteTasks: administer,
    assignOthers: administer,
  };
  const fetchMock = vi.fn<typeof fetch>().mockImplementation((input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (init?.method && init.method !== 'GET')
      return Promise.resolve(new Response('{}', { status: 403 }));
    const value = url.pathname.endsWith('/activity')
      ? { items: [], nextOffset: null }
      : url.pathname.endsWith('/tasks')
        ? { items: url.searchParams.get('status') === 'TODO' ? [task] : [], nextOffset: null }
        : url.pathname.endsWith('/projects/project-a')
          ? { project, permissions }
          : url.pathname.endsWith('/projects')
            ? { items: [project], nextOffset: null, permissions }
            : { workspaces: [{ workspace: { id: 'workspace-a', name: 'Design team' }, role }] };
    return Promise.resolve(new Response(JSON.stringify(value)));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

it.each(['Owner', 'Admin', 'Manager', 'Member', 'Viewer'] as const)(
  'presents resource controls for %s without broadening workspace privileges',
  async (role) => {
    setup(role);
    render(<ProjectsPanel userId="self" />);
    await screen.findByRole('button', { name: 'Launch' });
    expect(Boolean(screen.queryByRole('button', { name: 'Create project' }))).toBe(
      ['Owner', 'Admin', 'Manager'].includes(role),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }));
    await screen.findByRole('heading', { name: 'Launch' });
    expect(Boolean(screen.queryByRole('button', { name: 'Project settings' }))).toBe(
      ['Owner', 'Admin', 'Manager'].includes(role),
    );
    expect(Boolean(screen.queryByRole('button', { name: 'Create task' }))).toBe(role !== 'Viewer');
    expect(Boolean(screen.queryByLabelText('Status for Write spec'))).toBe(role !== 'Viewer');
  },
);
it('removes loading content and reports a denied move without showing a false success', async () => {
  const fetchMock = setup('Member');
  window.history.replaceState(null, '', '/?workspace=workspace-a&project=project-a');
  render(<ProjectsPanel userId="self" />);
  fireEvent.change(await screen.findByLabelText('Status for Write spec'), {
    target: { value: 'DONE' },
  });
  expect(await screen.findByRole('alert')).toHaveTextContent('current role');
  await waitFor(() => expect(screen.getByLabelText('Status for Write spec')).toHaveValue('TODO'));
  expect(
    fetchMock.mock.calls.some(
      ([, init]) => init?.body === JSON.stringify({ version: 1, status: 'DONE', beforeId: null }),
    ),
  ).toBe(true);
});
it('does not load a foreign workspace preference or silently switch its project into another tenant', async () => {
  const fetchMock = setup('Owner');
  window.history.replaceState(null, '', '/?workspace=foreign&project=secret');
  render(<ProjectsPanel userId="self" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('workspace is no longer available');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('shows no-workspace onboarding and retryable service failure', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('{}', { status: 503 }))
    .mockResolvedValue(new Response('{"workspaces":[]}'));
  vi.stubGlobal('fetch', fetchMock);
  render(<ProjectsPanel userId="self" />);
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh projects access' }));
  await screen.findByText(/Create or join a workspace/);
});
it('restricts Member assignment to self and protects someone else’s assignment', () => {
  const input: Task = { ...parseTask(task), assigneeId: 'another', assigneeName: 'Another member' };
  render(
    <TaskEditor
      task={input}
      permissions={{ administer: false, edit: true, assignOthers: false, deleteTasks: false }}
      userId="self"
      members={[]}
      pending={false}
      onSave={vi.fn()}
    />,
  );
  expect(screen.queryByLabelText('Assignee')).not.toBeInTheDocument();
  expect(screen.getByText(/Only a Manager/)).toBeVisible();
});
it('rejects malformed or unbounded API pages rather than trusting server-shaped input', () => {
  expect(() => parseTask({ ...task, status: 'UNKNOWN' })).toThrow();
  expect(() =>
    parsePage({ items: Array.from({ length: 51 }, () => task), nextOffset: null }, parseTask),
  ).toThrow();
});

it('loads a linked subtask through the authorized nested endpoint even beyond the current page', async () => {
  window.history.replaceState(null, '', '/?task=task-a&subtask=child-51');
  const fetchMock = vi.fn<typeof fetch>().mockImplementation((input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const data = url.endsWith('/projects/project-a')
      ? {
          project,
          permissions: { administer: false, edit: false, deleteTasks: false, assignOthers: false },
        }
      : url.endsWith('/subtasks/child-51')
        ? { ...task, id: 'child-51', title: 'Linked child', description: 'Exact child content' }
        : url.endsWith('/tasks/task-a')
          ? task
          : url.includes('/subtasks?')
            ? { items: [{ ...task, id: 'child-1', title: 'First child' }], nextOffset: 50 }
            : url.endsWith('/comments')
              ? { items: [], nextOffset: null, canComment: false }
              : { items: [], nextOffset: null };
    return Promise.resolve(new Response(JSON.stringify(data)));
  });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <TaskDetails
      base="/workspace-a/projects/project-a"
      taskId="task-a"
      userId="self"
      onClose={vi.fn()}
      onChanged={vi.fn()}
    />,
  );
  expect(await screen.findByRole('heading', { name: 'Linked child' })).toBeVisible();
  expect(screen.getByText('Selected subtask')).toBeVisible();
  expect(screen.getByText('Exact child content')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'First child' })).toBeVisible();
  expect(
    fetchMock.mock.calls.some(
      ([url]) => typeof url === 'string' && url.endsWith('/tasks/task-a/subtasks/child-51'),
    ),
  ).toBe(true);
});
