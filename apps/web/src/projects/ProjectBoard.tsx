import { useCallback, useState } from 'react';
import { Button } from '../components/ui/Button';
import { ConfirmDelete, CreateTaskForm, ProjectForm } from './ProjectForms';
import { TaskDetails } from './TaskDetails';
import {
  parsePage,
  parseProjectDetail,
  parseStatus,
  parseTask,
  projectRequest,
  statuses,
  statusLabels,
  type Status,
  type Task,
} from './project-api';
import { useProjectData } from './use-project-data';
import { ActivityHistory } from '../collaboration/ActivityHistory';
import { useCollaborationUpdates } from '../collaboration/use-realtime';

export function ProjectBoard({
  workspaceId,
  projectId,
  userId,
  onBack,
}: {
  workspaceId: string;
  projectId: string;
  userId: string;
  onBack: () => void;
}) {
  const base = `/${workspaceId}/projects/${projectId}`;
  const [offsets, setOffsets] = useState<Record<Status, number>>({
    TODO: 0,
    IN_PROGRESS: 0,
    DONE: 0,
  });
  const read = useCallback(
    async (signal: AbortSignal) => {
      const detail = parseProjectDetail(await projectRequest(base, 'GET', undefined, signal));
      const columns = await Promise.all(
        statuses.map(async (status) => ({
          status,
          ...parsePage(
            await projectRequest(
              `${base}/tasks?status=${status}&offset=${offsets[status]}`,
              'GET',
              undefined,
              signal,
            ),
            parseTask,
          ),
        })),
      );
      return { ...detail, columns };
    },
    [base, offsets],
  );
  const state = useProjectData(read);
  const [changed, setChanged] = useState(false);
  useCollaborationUpdates(workspaceId, () => setChanged(true));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('task'),
  );
  function openTask(id: string | null) {
    const previous = taskId;
    setTaskId(id);
    const url = new URL(window.location.href);
    url.searchParams.delete('subtask');
    if (id) url.searchParams.set('task', id);
    else url.searchParams.delete('task');
    window.history.replaceState(null, '', url.pathname + url.search);
    if (!id && previous)
      requestAnimationFrame(() => document.getElementById(`task-card-${previous}`)?.focus());
  }
  async function mutate(path: string, method: string, body?: unknown): Promise<boolean> {
    setPending(true);
    setError('');
    try {
      await projectRequest(path, method, body);
      await state.reload();
      return true;
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : 'Unable to save.');
      await state.reload();
      return false;
    } finally {
      setPending(false);
    }
  }
  function move(task: Task, status: Status, beforeId: string | null) {
    void mutate(`${base}/tasks/${task.id}/move`, 'POST', {
      version: task.version,
      status,
      beforeId,
    });
  }
  const data = state.data;
  const edit = data?.permissions.edit && !data.project.archived;
  return (
    <section className="projects-panel" aria-label="Project board">
      <div className="project-toolbar">
        <Button variant="secondary" onClick={onBack} disabled={pending}>
          All projects
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setChanged(false);
            void state.reload();
          }}
          disabled={pending || state.loading}
        >
          Refresh board
        </Button>
      </div>
      {changed ? (
        <p role="status">Workspace updated. Refresh board to review the latest tasks.</p>
      ) : null}
      <details>
        <summary>Project activity</summary>
        <ActivityHistory workspaceId={workspaceId} projectId={projectId} />
      </details>
      {error || state.error ? <p role="alert">{error || state.error}</p> : null}
      {state.loading ? <p role="status">Loading board…</p> : null}
      {data ? (
        <>
          <header className="project-toolbar">
            <div>
              <p className="eyebrow">Project / Kanban</p>
              <h2>{data.project.name}</h2>
            </div>
            {data.permissions.administer ? (
              <Button variant="secondary" disabled={pending} onClick={() => setSettings(!settings)}>
                Project settings
              </Button>
            ) : null}
          </header>
          <p className="project-description">{data.project.description}</p>
          {data.project.archived ? (
            <p role="status">
              Archived project — read-only. Restore it in project settings to continue work.
            </p>
          ) : !data.permissions.edit ? (
            <p>Read-only board</p>
          ) : null}
          {settings && data.permissions.administer ? (
            <section className="project-settings" aria-label="Project settings">
              <ProjectForm
                key={`${data.project.name}:${data.project.description}`}
                project={data.project}
                pending={pending}
                onSave={(input) => mutate(base, 'PATCH', input)}
              />
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => void mutate(base, 'PATCH', { archived: !data.project.archived })}
              >
                {data.project.archived ? 'Restore project' : 'Archive project'}
              </Button>
              <Button variant="ghost" disabled={pending} onClick={() => setDeleting(true)}>
                Delete project
              </Button>
            </section>
          ) : null}
          {edit ? (
            <CreateTaskForm
              pending={pending}
              onCreate={(title) => mutate(`${base}/tasks`, 'POST', { title })}
            />
          ) : null}
          <div className="kanban">
            {data.columns.map((column) => (
              <section
                key={column.status}
                className="kanban-column"
                aria-label={`${statusLabels[column.status]} column`}
              >
                <h3>{statusLabels[column.status]}</h3>
                {column.items.length === 0 ? <p>No tasks in this column.</p> : null}
                <ol className="kanban-tasks">
                  {column.items.map((task, index) => (
                    <li className="task-card" key={task.id}>
                      <Button
                        id={`task-card-${task.id}`}
                        className="task-card__title"
                        variant="ghost"
                        onClick={() => openTask(task.id)}
                      >
                        {task.title}
                      </Button>
                      <p>{task.assigneeName ?? 'Unassigned'}</p>
                      <small>{task.subtasks} subtasks</small>
                      {edit ? (
                        <div className="task-card__controls">
                          <label>
                            Move {task.title}
                            <select
                              aria-label={`Status for ${task.title}`}
                              value={task.status}
                              disabled={pending}
                              onChange={(event) =>
                                move(task, parseStatus(event.target.value), null)
                              }
                            >
                              {statuses.map((status) => (
                                <option value={status} key={status}>
                                  {statusLabels[status]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <Button
                            variant="secondary"
                            disabled={pending || index === 0}
                            aria-label={`Move ${task.title} up`}
                            onClick={() => {
                              const previous = column.items[index - 1];
                              if (previous) move(task, task.status, previous.id);
                            }}
                          >
                            ↑ Up
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={
                              pending ||
                              (index === column.items.length - 1 && column.nextOffset === null)
                            }
                            aria-label={`Move ${task.title} to end`}
                            onClick={() => move(task, task.status, null)}
                          >
                            To end
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ol>
                <div className="project-toolbar">
                  {offsets[column.status] > 0 ? (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setOffsets({
                          ...offsets,
                          [column.status]: Math.max(0, offsets[column.status] - 50),
                        })
                      }
                    >
                      Previous {statusLabels[column.status]} tasks
                    </Button>
                  ) : null}
                  {column.nextOffset !== null ? (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        setOffsets({ ...offsets, [column.status]: column.nextOffset ?? 0 })
                      }
                    >
                      Next {statusLabels[column.status]} tasks
                    </Button>
                  ) : null}
                </div>
              </section>
            ))}
          </div>
        </>
      ) : null}
      {taskId ? (
        <TaskDetails
          key={taskId}
          base={base}
          taskId={taskId}
          userId={userId}
          onClose={() => openTask(null)}
          onChanged={() => void state.reload()}
        />
      ) : null}
      {deleting && data ? (
        <ConfirmDelete
          label={data.project.name}
          pending={pending}
          onClose={() => setDeleting(false)}
          onConfirm={() => {
            void mutate(base, 'DELETE').then((ok) => {
              setDeleting(false);
              if (ok) onBack();
            });
          }}
        />
      ) : null}
    </section>
  );
}
