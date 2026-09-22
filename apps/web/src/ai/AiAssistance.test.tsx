import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AiAssistance } from './AiAssistance';

const json = (body: unknown, status = 200) => Response.json(body, { status });
function requestBody(init?: RequestInit): unknown {
  if (typeof init?.body !== 'string') throw new Error('Expected a JSON body');
  return JSON.parse(init.body) as unknown;
}
function payload(init?: RequestInit, operation = 'BREAKDOWN') {
  const body = requestBody(init);
  if (typeof body !== 'object' || body === null || !('requestId' in body))
    throw new Error('Missing request ID');
  return {
    requestId: body.requestId,
    operation,
    contextTruncated: false,
    suggestion:
      operation === 'BREAKDOWN'
        ? {
            summary: 'Review this proposal',
            subtasks: [
              { title: 'Suggested task', description: 'Suggested description' },
              { title: 'Second task', description: '' },
            ],
          }
        : operation === 'SUMMARY'
          ? {
              summary: '<script>Plain summary</script>',
              highlights: ['Persisted work'],
              limitations: ['Check completeness'],
            }
          : {
              summary: 'Action plan',
              steps: ['Verify acceptance'],
              questions: ['What remains unclear?'],
            },
  };
}
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AI assistance in project and task workflows', () => {
  it('renders a safe project summary and limits notice without applying anything', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation((_, init) =>
        Promise.resolve(json({ ...payload(init, 'SUMMARY'), contextTruncated: true })),
      );
    vi.stubGlobal('fetch', fetch);
    render(<AiAssistance base="/w/projects/p" kind="project" />);
    fireEvent.click(screen.getByRole('button', { name: 'Summarize project' }));
    expect(await screen.findByText('<script>Plain summary</script>')).toBeInTheDocument();
    expect(screen.getByText(/limited selection/)).toBeInTheDocument();
    expect(screen.getByText('Persisted work')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Confirm and create subtasks' }),
    ).not.toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('shows editable preview, requires confirmation and guards duplicate generation/apply clicks', async () => {
    const generation = deferred();
    const application = deferred();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockReturnValueOnce(generation.promise)
      .mockReturnValueOnce(application.promise);
    vi.stubGlobal('fetch', fetch);
    const onApplied = vi.fn();
    render(<AiAssistance base="/w/projects/p/tasks/t" kind="task" onApplied={onApplied} />);
    const button = screen.getByRole('button', { name: 'Suggest subtasks' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Working');
    await act(async () => {
      generation.resolve(json(payload(fetch.mock.calls[0]?.[1])));
      await generation.promise;
    });
    expect(screen.getByText('AI suggestion — review required')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Suggested title 1'), {
      target: { value: 'Human reviewed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove suggestion 2' }));
    const apply = screen.getByRole('button', { name: 'Confirm and create subtasks' });
    fireEvent.click(apply);
    fireEvent.click(apply);
    expect(fetch).toHaveBeenCalledTimes(2);
    const submitted = requestBody(fetch.mock.calls[1]?.[1]);
    expect(submitted).toMatchObject({
      subtasks: [{ title: 'Human reviewed', description: 'Suggested description' }],
    });
    expect(submitted).toHaveProperty('requestId', payload(fetch.mock.calls[0]?.[1]).requestId);
    await act(async () => {
      application.resolve(json({ createdCount: 1 }));
      await application.promise;
    });
    expect(screen.getByRole('status')).toHaveTextContent('Approved subtasks created');
    expect(onApplied).toHaveBeenCalledTimes(1);
  });
  it('cancels a preview without applying data and shows action plans', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation((url, init) =>
        Promise.resolve(
          json(
            payload(init, typeof url === 'string' && url.endsWith('/plan') ? 'PLAN' : 'BREAKDOWN'),
          ),
        ),
      );
    vi.stubGlobal('fetch', fetch);
    render(<AiAssistance base="/w/projects/p/tasks/t" kind="task" />);
    fireEvent.click(screen.getByRole('button', { name: 'Suggest subtasks' }));
    await screen.findByLabelText('Suggested title 1');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel AI preview' }));
    expect(screen.queryByLabelText('Suggested title 1')).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Suggest action plan' }));
    expect(await screen.findByText('Verify acceptance')).toBeInTheDocument();
  });
  it.each([403, 409, 429, 502, 503, 504])(
    'presents recoverable failures for status %s',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(json({ message: 'untrusted server text' }, status)),
      );
      render(<AiAssistance base="/w/projects/p/tasks/t" kind="task" />);
      fireEvent.click(screen.getByRole('button', { name: 'Suggest subtasks' }));
      expect(await screen.findByRole('alert')).not.toHaveTextContent('untrusted server text');
      expect(screen.getByRole('button', { name: 'Suggest subtasks' })).toBeEnabled();
    },
  );
  it('retains the same receipt and edits when retrying an ambiguous apply failure', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementationOnce((_, init) => Promise.resolve(json(payload(init))))
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(json({ createdCount: 2 }));
    vi.stubGlobal('fetch', fetch);
    render(<AiAssistance base="/w/projects/p/tasks/t" kind="task" />);
    fireEvent.click(screen.getByRole('button', { name: 'Suggest subtasks' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm and create subtasks' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and create subtasks' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Approved subtasks created'),
    );
    expect(fetch.mock.calls[1]?.[1]?.body).toEqual(fetch.mock.calls[2]?.[1]?.body);
  });
  it.each(['switch', 'cancel'] as const)(
    'ignores a late response after %s even if transport ignores abort',
    async (mode) => {
      const old = deferred();
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockReturnValueOnce(old.promise)
        .mockImplementationOnce((_, init) => Promise.resolve(json(payload(init, 'PLAN'))));
      vi.stubGlobal('fetch', fetch);
      const view = render(<AiAssistance base="/old/projects/p/tasks/t" kind="task" />);
      fireEvent.click(screen.getByRole('button', { name: 'Suggest subtasks' }));
      if (mode === 'switch')
        view.rerender(<AiAssistance base="/new/projects/p/tasks/t" kind="task" />);
      else fireEvent.click(screen.getByRole('button', { name: 'Cancel AI preview' }));
      expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Suggest action plan' }));
      await screen.findByText('Verify acceptance');
      await act(async () => {
        old.resolve(json(payload(fetch.mock.calls[0]?.[1])));
        await old.promise;
      });
      expect(screen.queryByLabelText('Suggested title 1')).not.toBeInTheDocument();
      expect(screen.getByText('Verify acceptance')).toBeInTheDocument();
    },
  );
});
