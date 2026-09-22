import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReportingData } from './ReportingPanel';
import * as api from './reporting-api';

const json = (data: unknown, status = 200) => Response.json(data, { status });
const path = (input: RequestInfo | URL) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
const counts = { total: 0, TODO: 0, IN_PROGRESS: 0, DONE: 0, completionPercent: 0 };
function report(workspaceId = 'w', audit = true, populated = true) {
  return {
    workspaceId,
    range: '7d',
    generatedAt: '2026-09-22T10:00:00Z',
    project: null,
    projects: {
      total: populated ? 1 : 0,
      active: populated ? 1 : 0,
      archived: 0,
      items: populated ? [{ id: 'p', name: 'Release', archived: false }] : [],
    },
    tasks: populated ? { ...counts, total: 1, DONE: 1, completionPercent: 100 } : counts,
    subtasks: counts,
    workload: [
      {
        userId: 'member',
        name: 'Workspace member',
        tasks: populated ? 1 : 0,
        subtasks: 0,
        open: 0,
        done: populated ? 1 : 0,
      },
    ],
    trend: [
      {
        day: '2026-09-22',
        created: populated ? 1 : 0,
        completed: populated ? 1 : 0,
        activity: populated ? 2 : 0,
      },
    ],
    page: { offset: 0, nextOffset: null },
    permissions: { audit },
  };
}
function events(nextCursor: string | null = null, action = 'TASK_CREATED') {
  return {
    nextCursor,
    items: [
      {
        id: 'event',
        actorUserId: 'actor',
        action,
        entityType: 'TASK',
        entityId: 'task',
        metadata: { version: 1, fields: ['title'] },
        createdAt: '2026-09-22T10:00:00Z',
      },
    ],
  };
}
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Workspace analytics, report exports and audit UI', () => {
  it('shows loading, honest empty state and summary/workload/trend data', async () => {
    const pending = deferred();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(json(report()));
    vi.stubGlobal('fetch', fetch);
    render(<ReportingData workspaceId="w" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading report data');
    await act(async () => {
      pending.resolve(json(report('w', true, false)));
      await pending.promise;
    });
    expect(screen.getByText('No work items in this scope yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh report data' }));
    expect(await screen.findByText('100%')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Member workload' })).toHaveTextContent(
      'Workspace member',
    );
    expect(screen.getByRole('table', { name: 'Daily trend (UTC)' })).toHaveTextContent(
      '2026-09-22',
    );
  });
  it('supports range changes, workspace/project report rendering and report pagination', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation((url) => {
      const value = report();
      const route = path(url);
      return Promise.resolve(
        json({
          ...value,
          ...(route.includes('/projects/p/')
            ? {
                project: {
                  id: 'p',
                  name: 'Release',
                  description: 'Project details',
                  archived: false,
                },
              }
            : {}),
          page: {
            offset: route.includes('offset=50') ? 50 : 0,
            nextOffset: route.includes('offset=50') ? null : 50,
          },
        }),
      );
    });
    vi.stubGlobal('fetch', fetch);
    render(<ReportingData workspaceId="w" />);
    await screen.findByText('100%');
    fireEvent.change(screen.getByLabelText('Time range'), { target: { value: '90d' } });
    await waitFor(() =>
      expect(fetch).toHaveBeenLastCalledWith(
        expect.stringContaining('range=90d'),
        expect.anything(),
      ),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Next report page' }));
    await waitFor(() =>
      expect(fetch).toHaveBeenLastCalledWith(
        expect.stringContaining('offset=50'),
        expect.anything(),
      ),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Release · Active' }));
    expect(
      await screen.findByRole('heading', { name: 'Project report: Release' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Project details/)).toBeInTheDocument();
    expect(fetch).toHaveBeenLastCalledWith(
      expect.stringContaining('/projects/p/report?range=90d&offset=0'),
      expect.anything(),
    );
  });
  it('downloads only on explicit action, guards duplicate export and presents failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(json(report()))),
    );
    let reject!: (error: Error) => void;
    const download = vi.spyOn(api, 'downloadReport').mockImplementation(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    render(<ReportingData workspaceId="w" />);
    fireEvent.click(screen.getByRole('button', { name: 'Reports' }));
    const button = await screen.findByRole('button', { name: 'Download this report page as CSV' });
    expect(download).not.toHaveBeenCalled();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(download).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    await act(async () => {
      reject(new Error('Export temporarily unavailable'));
      await Promise.resolve();
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Export temporarily unavailable');
    expect(button).toBeEnabled();
  });
  it('hides audit from roles without permission', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(report('w', false))));
    render(<ReportingData workspaceId="w" />);
    await screen.findByText('100%');
    expect(screen.queryByRole('button', { name: 'Audit log' })).not.toBeInTheDocument();
  });
  it('filters and pages authorized audit history with safe text metadata', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation((url) =>
        Promise.resolve(
          json(
            path(url).includes('/audit?')
              ? events(
                  path(url).includes('cursor=') ? null : 'next',
                  path(url).includes('cursor=') ? 'TASK_UPDATED' : 'TASK_CREATED',
                )
              : report(),
          ),
        ),
      );
    vi.stubGlobal('fetch', fetch);
    render(<ReportingData workspaceId="w" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Audit log' }));
    await screen.findByText('task created', { selector: 'strong' });
    fireEvent.change(screen.getByLabelText('Audit action'), { target: { value: 'TASK_CREATED' } });
    fireEvent.change(screen.getByLabelText('Actor user ID'), { target: { value: 'actor' } });
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-09-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply audit filters' }));
    await waitFor(() =>
      expect(fetch).toHaveBeenLastCalledWith(
        expect.stringContaining('action=TASK_CREATED&actorUserId=actor&from=2026-09-01'),
        expect.anything(),
      ),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Older audit events' }));
    expect(await screen.findByText('task updated', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('version: 1')).toBeInTheDocument();
  });
  it('shows permission/date filter errors and empty audit results', async () => {
    let status = 400;
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation((url) =>
        Promise.resolve(
          path(url).includes('/audit?')
            ? json(status === 200 ? { items: [], nextCursor: null } : {}, status)
            : json(report()),
        ),
      );
    vi.stubGlobal('fetch', fetch);
    render(<ReportingData workspaceId="w" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Audit log' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('90 days');
    status = 200;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh audit' }));
    expect(await screen.findByText('No audit events in this range.')).toBeInTheDocument();
  });
  it('clears old tenant data and ignores late responses when switching workspace', async () => {
    const old = deferred();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(json(report('new', false, false)));
    vi.stubGlobal('fetch', fetch);
    const view = render(<ReportingData workspaceId="old" />);
    view.rerender(<ReportingData workspaceId="new" />);
    await screen.findByText('No work items in this scope yet.');
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await act(async () => {
      old.resolve(json(report('old')));
      await old.promise;
    });
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Audit log' })).not.toBeInTheDocument();
  });
  it('shows read errors and supports explicit retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(json({}, 404)).mockResolvedValueOnce(json(report())),
    );
    render(<ReportingData workspaceId="w" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer available');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh report data' }));
    expect(await screen.findByText('100%')).toBeInTheDocument();
  });
});
