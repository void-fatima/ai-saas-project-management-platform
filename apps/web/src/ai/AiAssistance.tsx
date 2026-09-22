import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/Button';
import { aiRequest, parseSuggestion, type Operation, type Suggestion } from './ai-api';

export function AiAssistance(props: {
  base: string;
  kind: 'project' | 'task';
  onApplied?: () => void;
}) {
  // Remount on resource changes: late responses cannot populate another tenant/resource.
  return <ScopedAssistance key={props.base} {...props} />;
}
function ScopedAssistance({
  base,
  kind,
  onApplied,
}: {
  base: string;
  kind: 'project' | 'task';
  onApplied?: () => void;
}) {
  const [preview, setPreview] = useState<Suggestion | null>(null);
  const [operation, setOperation] = useState<Operation>('summary');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const current = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      current.current?.abort();
      current.current = null;
    },
    [],
  );
  function cancel() {
    current.current?.abort();
    current.current = null;
    setPending(false);
    setPreview(null);
    setError('');
    setNotice('');
  }
  async function generate(next: Operation) {
    if (current.current) return;
    const controller = new AbortController();
    current.current = controller;
    setPending(true);
    setError('');
    setPreview(null);
    setNotice('');
    setOperation(next);
    const requestId = crypto.randomUUID();
    try {
      const value = await aiRequest(`${base}/ai/${next}`, { requestId }, controller.signal);
      if (current.current === controller) setPreview(parseSuggestion(value, next, requestId));
    } catch (failure: unknown) {
      if (current.current === controller)
        setError(failure instanceof Error ? failure.message : 'AI assistance failed.');
    } finally {
      if (current.current === controller) {
        current.current = null;
        setPending(false);
      }
    }
  }
  async function apply() {
    if (!preview || current.current) return;
    const controller = new AbortController();
    current.current = controller;
    setPending(true);
    setError('');
    try {
      await aiRequest(
        `${base}/ai/breakdown/apply`,
        { requestId: preview.requestId, subtasks: preview.subtasks },
        controller.signal,
      );
      if (current.current === controller) {
        setPreview(null);
        setNotice('Approved subtasks created.');
        onApplied?.();
      }
    } catch (failure: unknown) {
      if (current.current === controller)
        setError(failure instanceof Error ? failure.message : 'Unable to apply subtasks.');
    } finally {
      if (current.current === controller) {
        current.current = null;
        setPending(false);
      }
    }
  }
  return (
    <section
      className="project-settings ai-assistance"
      aria-label="AI assistance"
      aria-busy={pending}
    >
      <h3>AI assistance</h3>
      <p>
        Selected project and task content is sent to the configured AI provider. Review suggestions
        before using them.
      </p>
      <div className="project-toolbar">
        {kind === 'project' ? (
          <Button variant="secondary" disabled={pending} onClick={() => void generate('summary')}>
            Summarize project
          </Button>
        ) : (
          <>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => void generate('breakdown')}
            >
              Suggest subtasks
            </Button>
            <Button variant="secondary" disabled={pending} onClick={() => void generate('plan')}>
              Suggest action plan
            </Button>
          </>
        )}
      </div>
      {pending ? <p role="status">Working on your AI request…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {preview ? (
        <div>
          <h4>AI suggestion — review required</h4>
          <p className="project-description">{preview.summary}</p>
          {preview.truncated ? (
            <p>
              Based on a limited selection of project content; check the full project before
              deciding.
            </p>
          ) : null}
          <ol>
            {preview.details.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ol>
          <ul>
            {preview.notes.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
          {operation === 'breakdown' ? (
            <form
              className="project-form"
              aria-label="Review suggested subtasks"
              onSubmit={(event) => {
                event.preventDefault();
                void apply();
              }}
            >
              {preview.subtasks.map((draft, index) => (
                <fieldset key={index} disabled={pending}>
                  <legend>Suggested subtask {index + 1}</legend>
                  <label>
                    Suggested title {index + 1}
                    <input
                      className="input"
                      required
                      maxLength={200}
                      value={draft.title}
                      onChange={(event) =>
                        setPreview({
                          ...preview,
                          subtasks: preview.subtasks.map((item, i) =>
                            i === index ? { ...item, title: event.target.value } : item,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Suggested description {index + 1}
                    <textarea
                      maxLength={2000}
                      value={draft.description}
                      onChange={(event) =>
                        setPreview({
                          ...preview,
                          subtasks: preview.subtasks.map((item, i) =>
                            i === index ? { ...item, description: event.target.value } : item,
                          ),
                        })
                      }
                    />
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={pending || preview.subtasks.length === 1}
                    onClick={() =>
                      setPreview({
                        ...preview,
                        subtasks: preview.subtasks.filter((_, i) => i !== index),
                      })
                    }
                  >
                    Remove suggestion {index + 1}
                  </Button>
                </fieldset>
              ))}
              <p>
                Confirming creates {preview.subtasks.length} unassigned subtasks in To do. The
                preview expires after 15 minutes.
              </p>
              <Button type="submit" disabled={pending}>
                Confirm and create subtasks
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
      {preview || pending ? (
        <Button variant="ghost" disabled={pending && preview !== null} onClick={cancel}>
          Cancel AI preview
        </Button>
      ) : null}
    </section>
  );
}
