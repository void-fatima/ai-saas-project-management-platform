import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { DashboardData } from './WorkspaceDashboard';
import { CommandPalette } from '../components/CommandPalette';
import { refreshCollaboration } from '../collaboration/use-realtime';
import { parseDashboard, parseSearch, resourceLink } from './discovery-api';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const urlText = (value: RequestInfo | URL | undefined) =>
  typeof value === 'string' ? value : value instanceof URL ? value.href : (value?.url ?? '');
const date = '2026-09-21T00:00:00.000Z';
const counts = { total: 0, TODO: 0, IN_PROGRESS: 0, DONE: 0 };
function dashboard(workspaceId = 'a', title = '') {
  const items = title
    ? [{ id: 'task', projectId: 'project', parentId: null, title, status: 'TODO', updatedAt: date }]
    : [];
  return {
    workspaceId,
    projects: { total: title ? 1 : 0, active: title ? 1 : 0, archived: 0 },
    tasks: { ...counts, TODO: items.length, total: items.length },
    subtasks: counts,
    assignedToMe: { total: items.length, items },
    recentTasks: items,
    activity: [],
  };
}
function result(kind: 'PROJECT' | 'TASK' | 'SUBTASK', title = 'Launch') {
  return {
    kind,
    id: kind.toLowerCase(),
    projectId: 'project',
    parentId: kind === 'SUBTASK' ? 'task' : null,
    title,
    snippet: '<script>plain text</script>',
    status: kind === 'PROJECT' ? null : 'TODO',
    archived: false,
    updatedAt: date,
  };
}
function deferred() {
  let resolve: (response: Response) => void = () => {
    throw new Error('Not initialized');
  };
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function tick(ms = 0) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}
const props = () => ({
  open: true,
  workspaceId: 'a',
  onWorkspaceChange: vi.fn(),
  onClose: vi.fn(),
  onFocusApi: vi.fn(),
  onRefresh: vi.fn(),
  navigate: vi.fn(),
});
function mockSearch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  const mock = vi.fn<typeof fetch>().mockImplementation((input, init) => {
    const url = urlText(input);
    return url.endsWith('/workspaces')
      ? Promise.resolve(
          json({
            workspaces: ['a', 'b'].map((id) => ({
              workspace: { id, name: 'Workspace ' + id },
              role: 'Viewer',
            })),
          }),
        )
      : handler(url, init);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Persisted workspace dashboard', () => {
  it('renders loading, empty and populated data with accessible status counts and safe links', async () => {
    const pending = deferred();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(json(dashboard('a', 'Launch')));
    vi.stubGlobal('fetch', fetchMock);
    render(<DashboardData workspaceId="a" />);
    expect(screen.getByText('Loading dashboard…')).toBeInTheDocument();
    await act(async () => {
      pending.resolve(json(dashboard()));
      await pending.promise;
    });
    expect(screen.getByText(/No projects yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh dashboard' }));
    await tick();
    expect(screen.getAllByRole('link', { name: 'Launch' })).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'Launch' })[0]).toHaveAttribute(
      'href',
      '/?view=projects&workspace=a&project=project&task=task',
    );
    expect(
      within(screen.getByRole('row', { name: 'To do 1 0' })).getByRole('rowheader'),
    ).toHaveTextContent('To do');
    expect(screen.getByText('0 of 1 completed')).toBeInTheDocument();
  });
  it('shows failures and denied access, clears old data and supports retry', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json(dashboard('a', 'Launch')))
      .mockResolvedValueOnce(json({}, 404));
    vi.stubGlobal('fetch', fetchMock);
    render(<DashboardData workspaceId="a" />);
    await tick();
    expect(screen.getByRole('alert')).toHaveTextContent('temporarily unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh dashboard' }));
    await tick();
    expect(screen.getAllByText('Launch')).toHaveLength(2);
    act(() => refreshCollaboration('a'));
    await tick(150);
    expect(screen.getByRole('alert')).toHaveTextContent('no longer available');
    expect(screen.queryByText('Launch')).not.toBeInTheDocument();
  });
  it('clears prior workspace data synchronously, aborts old reads and rejects late responses', async () => {
    const late = deferred();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(dashboard('a', 'Secret A')))
      .mockReturnValueOnce(late.promise)
      .mockResolvedValueOnce(json(dashboard('b', 'Public B')));
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<DashboardData workspaceId="a" />);
    await tick();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh dashboard' }));
    view.rerender(<DashboardData workspaceId="b" />);
    expect(screen.queryByText('Secret A')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
    await tick();
    await act(async () => {
      late.resolve(json(dashboard('a', 'Late A')));
      await late.promise;
    });
    expect(screen.queryByText('Late A')).not.toBeInTheDocument();
    expect(screen.getAllByText('Public B')).toHaveLength(2);
  });
  it('coalesces duplicate hints, ignores foreign hints and repairs reconnect without overlapping requests', async () => {
    const slow = deferred();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(dashboard()))
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValue(json(dashboard()));
    vi.stubGlobal('fetch', fetchMock);
    render(<DashboardData workspaceId="a" />);
    await tick();
    act(() => {
      refreshCollaboration('b');
    });
    await tick(150);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const refresh = screen.getByRole('button', { name: 'Refresh dashboard' });
    refresh.focus();
    act(() => {
      refreshCollaboration('a');
      refreshCollaboration('a');
    });
    await tick(150);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refresh).toBeEnabled();
    expect(refresh).toHaveFocus();
    fireEvent.click(refresh);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    act(() => {
      refreshCollaboration();
      refreshCollaboration('a');
    });
    await tick(150);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      slow.resolve(json(dashboard()));
      await slow.promise;
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('Workspace command search', () => {
  it('debounces, labels resource kinds, renders snippets as text, and navigates with the keyboard', async () => {
    const mock = mockSearch(() =>
      Promise.resolve(
        json({ items: [result('PROJECT'), result('TASK'), result('SUBTASK')], nextOffset: null }),
      ),
    );
    const callbacks = props();
    render(<CommandPalette {...callbacks} />);
    await tick();
    const input = screen.getByRole('combobox', { name: 'Search workspace' });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: 'La' } });
    await tick(200);
    fireEvent.change(input, { target: { value: 'Launch' } });
    await tick(249);
    expect(mock.mock.calls.filter(([url]) => urlText(url).includes('/search?'))).toHaveLength(0);
    await tick(1);
    expect(
      screen.getAllByRole('option').filter((item) => item.id.startsWith('command-option')),
    ).toHaveLength(3);
    expect(screen.getByRole('option', { name: 'Project: Launch' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Subtask: Launch' })).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(
      document.getElementById(input.getAttribute('aria-activedescendant') ?? ''),
    ).toHaveAttribute('aria-label', 'Subtask: Launch');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(callbacks.navigate).toHaveBeenCalledWith(
      '/?view=projects&workspace=a&project=project&task=task',
    );
    expect(callbacks.onClose).toHaveBeenCalledOnce();
  });
  it('cancels searches on text or workspace changes, clears results immediately, and ignores late responses', async () => {
    const late = deferred();
    const mock = mockSearch(async (url) =>
      url.includes('/a/')
        ? late.promise
        : json({ items: [result('PROJECT', 'Public B')], nextOffset: null }),
    );
    const callbacks = props();
    const view = render(<CommandPalette {...callbacks} />);
    await tick();
    const input = screen.getByRole('combobox', { name: 'Search workspace' });
    fireEvent.change(input, { target: { value: 'Secret A' } });
    await tick(250);
    const request = mock.mock.calls.find(([url]) => urlText(url).includes('/a/search'));
    fireEvent.change(input, { target: { value: 'Public B' } });
    expect(request?.[1]?.signal?.aborted).toBe(true);
    view.rerender(<CommandPalette {...callbacks} workspaceId="b" />);
    expect(screen.queryByRole('option', { name: /Secret A/ })).not.toBeInTheDocument();
    await tick(250);
    await act(async () => {
      late.resolve(json({ items: [result('PROJECT', 'Secret A')], nextOffset: null }));
      await late.promise;
    });
    expect(screen.queryByRole('option', { name: /Secret A/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Project: Public B' })).toBeInTheDocument();
    view.rerender(<CommandPalette {...callbacks} workspaceId="a" />);
    expect(screen.queryByRole('option', { name: /Public B/ })).not.toBeInTheDocument();
  });
  it('handles failure, retry, no results, query limits, archive inclusion and pagination', async () => {
    let attempt = 0;
    const mock = mockSearch(() =>
      Promise.resolve(
        ++attempt === 1
          ? json({}, 503)
          : attempt === 2
            ? json({ items: [], nextOffset: null })
            : json({ items: [result('PROJECT')], nextOffset: attempt === 3 ? 20 : null }),
      ),
    );
    render(<CommandPalette {...props()} />);
    await tick();
    const input = screen.getByRole('combobox', { name: 'Search workspace' });
    fireEvent.change(input, { target: { value: 'x' } });
    await tick(250);
    expect(screen.getByText('Use between 2 and 100 characters.')).toBeInTheDocument();
    expect(attempt).toBe(0);
    fireEvent.change(input, { target: { value: 'Launch' } });
    await tick(250);
    expect(screen.getByRole('alert')).toHaveTextContent('temporarily unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry search' }));
    await tick();
    expect(screen.getByText('No results in this workspace.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include archived projects' }));
    await tick(250);
    expect(urlText(mock.mock.calls.at(-1)?.[0])).toContain('includeArchived=true');
    fireEvent.click(screen.getByRole('button', { name: 'Next results' }));
    await tick(250);
    expect(urlText(mock.mock.calls.at(-1)?.[0])).toContain('offset=20');
    fireEvent.change(screen.getByRole('combobox', { name: 'Search workspace scope' }), {
      target: { value: 'b' },
    });
  });
  it('validates bounded DTOs and constructs local encoded navigation paths', () => {
    expect(() => parseDashboard({})).toThrow();
    expect(() =>
      parseSearch({ items: Array.from({ length: 51 }, () => result('TASK')), nextOffset: null }),
    ).toThrow();
    expect(resourceLink('a', result('SUBTASK'))).toBe(
      '/?view=projects&workspace=a&project=project&task=task&subtask=subtask',
    );
    expect(resourceLink('a', { ...result('PROJECT'), projectId: 'javascript:alert(1)' })).toBe(
      '/?view=projects&workspace=a&project=javascript%3Aalert%281%29',
    );
  });
});
