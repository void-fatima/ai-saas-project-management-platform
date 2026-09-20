import { useCallback, useState } from 'react';
import { Button } from '../components/ui/Button';
import { parseWorkspaces, workspaceRequest } from '../workspaces/workspace-api';
import { ProjectBoard } from './ProjectBoard';
import { ProjectForm } from './ProjectForms';
import { parseProjects, projectRequest } from './project-api';
import { useProjectData } from './use-project-data';

export function ProjectsPanel({ userId }: { userId: string }) {
  const read = useCallback(
    async (signal: AbortSignal) =>
      parseWorkspaces(
        await workspaceRequest(
          '',
          'GET',
          undefined,
          AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
        ),
      ),
    [],
  );
  const state = useProjectData(read);
  const [workspace, setWorkspace] = useState(
    () => new URLSearchParams(window.location.search).get('workspace') ?? '',
  );
  const [project, setProject] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('project'),
  );
  const selected = workspace || state.data?.[0]?.workspace.id || '';
  function select(w: string, p: string | null) {
    setWorkspace(w);
    setProject(p);
    const url = new URL(window.location.href);
    url.searchParams.set('workspace', w);
    url.searchParams.delete('task');
    if (p) url.searchParams.set('project', p);
    else url.searchParams.delete('project');
    window.history.replaceState(null, '', url.pathname + url.search);
  }
  const available = state.data?.some((choice) => choice.workspace.id === selected);
  return (
    <section className="projects-panel" aria-label="Projects">
      <header className="project-toolbar">
        <h2>Projects</h2>
        <Button variant="ghost" onClick={() => void state.reload()} disabled={state.loading}>
          Refresh projects access
        </Button>
      </header>
      {state.loading ? <p role="status">Loading workspaces…</p> : null}
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.data ? (
        <>
          {state.data.length ? (
            <label className="form-field">
              Project workspace
              <select
                value={available ? selected : ''}
                onChange={(event) => select(event.target.value, null)}
              >
                <option value="" disabled>
                  Select a workspace
                </option>
                {state.data.map((choice) => (
                  <option key={choice.workspace.id} value={choice.workspace.id}>
                    {choice.workspace.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p>Create or join a workspace from Workspaces to start a project.</p>
          )}
          {!available && workspace ? (
            <p role="alert">This workspace is no longer available. Select another workspace.</p>
          ) : null}
          {available ? (
            project ? (
              <ProjectBoard
                key={`${selected}:${project}`}
                workspaceId={selected}
                projectId={project}
                userId={userId}
                onBack={() => select(selected, null)}
              />
            ) : (
              <ProjectList
                key={selected}
                workspaceId={selected}
                onSelect={(id) => select(selected, id)}
              />
            )
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function ProjectList({
  workspaceId,
  onSelect,
}: {
  workspaceId: string;
  onSelect: (id: string) => void;
}) {
  const [offset, setOffset] = useState(0);
  const read = useCallback(
    async (signal: AbortSignal) =>
      parseProjects(
        await projectRequest(`/${workspaceId}/projects?offset=${offset}`, 'GET', undefined, signal),
      ),
    [workspaceId, offset],
  );
  const state = useProjectData(read);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function create(input: { name: string; description: string }) {
    setPending(true);
    setError('');
    try {
      await projectRequest(`/${workspaceId}/projects`, 'POST', input);
      await state.reload();
      return true;
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : 'Unable to create project.');
      await state.reload();
      return false;
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      {state.loading ? <p role="status">Loading projects…</p> : null}
      {error || state.error ? <p role="alert">{error || state.error}</p> : null}
      <Button
        variant="ghost"
        disabled={pending || state.loading}
        onClick={() => void state.reload()}
      >
        Refresh project list
      </Button>
      {state.data ? (
        <>
          {state.data.permissions.administer ? (
            <ProjectForm pending={pending} onSave={create} />
          ) : (
            <p>
              {state.data.permissions.edit
                ? 'You can create and update tasks inside a project.'
                : 'Read-only projects'}
            </p>
          )}
          {state.data.items.length === 0 ? (
            <p>No projects yet. An Owner, Admin or Manager can create one.</p>
          ) : null}
          <ul className="project-list">
            {state.data.items.map((project) => (
              <li key={project.id}>
                <Button variant="secondary" onClick={() => onSelect(project.id)}>
                  {project.name}
                </Button>
                {project.archived ? <span>Archived</span> : null}
                <p className="project-description">{project.description}</p>
              </li>
            ))}
          </ul>
          <div className="project-toolbar">
            {offset > 0 ? (
              <Button onClick={() => setOffset(Math.max(0, offset - 50))}>Previous projects</Button>
            ) : null}
            {state.data.nextOffset !== null ? (
              <Button onClick={() => setOffset(state.data?.nextOffset ?? 0)}>Next projects</Button>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}
