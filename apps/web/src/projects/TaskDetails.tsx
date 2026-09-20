import { useCallback, useState } from 'react';
import { useModalDialog } from '../components/use-modal-dialog';
import { Button } from '../components/ui/Button';
import { CreateTaskForm, ConfirmDelete } from './ProjectForms';
import { TaskEditor } from './TaskEditor';
import {
  parseAssignee,
  parsePage,
  parseProjectDetail,
  parseTask,
  projectRequest,
  statusLabels,
  type Task,
} from './project-api';
import { useProjectData } from './use-project-data';

export function TaskDetails({
  base,
  taskId,
  userId,
  onClose,
  onChanged,
}: {
  base: string;
  taskId: string;
  userId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const dialog = useModalDialog(true);
  const [offset, setOffset] = useState(0);
  const read = useCallback(
    async (signal: AbortSignal) => {
      const projectDetail = parseProjectDetail(
        await projectRequest(base, 'GET', undefined, signal),
      );
      const [root, children, members] = await Promise.all([
        projectRequest(`${base}/tasks/${taskId}`, 'GET', undefined, signal),
        projectRequest(
          `${base}/tasks/${taskId}/subtasks?offset=${offset}`,
          'GET',
          undefined,
          signal,
        ),
        projectDetail.permissions.assignOthers && !projectDetail.project.archived
          ? projectRequest(
              `${base.slice(0, base.lastIndexOf('/'))}/assignees`,
              'GET',
              undefined,
              signal,
            )
          : Promise.resolve({ items: [], nextOffset: null }),
      ]);
      return {
        task: parseTask(root),
        children: parsePage(children, parseTask),
        members: parsePage(members, parseAssignee),
        ...projectDetail,
      };
    },
    [base, taskId, offset],
  );
  const state = useProjectData(read);
  const [moreMembers, setMoreMembers] = useState<ReturnType<typeof parseAssignee>[]>([]);
  const [memberOffset, setMemberOffset] = useState<number | null | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [editingChild, setEditingChild] = useState<string | null>(null);
  async function mutate(path: string, method: string, body?: unknown): Promise<boolean> {
    setPending(true);
    setError('');
    try {
      await projectRequest(path, method, body);
      onChanged();
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
  async function loadMembers() {
    const next = memberOffset === undefined ? state.data?.members.nextOffset : memberOffset;
    if (next === null || next === undefined) return;
    setPending(true);
    setError('');
    try {
      const page = parsePage(
        await projectRequest(`${base.slice(0, base.lastIndexOf('/'))}/assignees?offset=${next}`),
        parseAssignee,
      );
      setMoreMembers((members) => [...members, ...page.items]);
      setMemberOffset(page.nextOffset);
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : 'Unable to load members.');
    } finally {
      setPending(false);
    }
  }
  const data = state.data;
  const edit = data?.permissions.edit && !data.project.archived;
  const members = [...(data?.members.items ?? []), ...moreMembers];
  return (
    <dialog
      ref={dialog}
      className="workspace-dialog task-dialog"
      aria-label="Task details"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
    >
      <header className="project-toolbar">
        <h2>Task details</h2>
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          Close task
        </Button>
      </header>
      {error || state.error ? <p role="alert">{error || state.error}</p> : null}
      {state.loading ? (
        <p role="status">Loading task…</p>
      ) : (
        <Button variant="ghost" disabled={pending} onClick={() => void state.reload()}>
          Reload task
        </Button>
      )}
      {data ? (
        <>
          {edit ? (
            <TaskEditor
              key={`${data.task.id}:${data.task.version}`}
              task={data.task}
              permissions={data.permissions}
              userId={userId}
              members={members}
              pending={pending}
              onSave={(input) => void mutate(`${base}/tasks/${taskId}`, 'PATCH', input)}
            />
          ) : (
            <section>
              <h3>{data.task.title}</h3>
              <p className="project-description">{data.task.description}</p>
              <p>
                {statusLabels[data.task.status]} · {data.task.assigneeName ?? 'Unassigned'}
              </p>
            </section>
          )}
          {edit &&
          data.permissions.assignOthers &&
          (memberOffset === undefined ? data.members.nextOffset : memberOffset) !== null ? (
            <Button variant="ghost" disabled={pending} onClick={() => void loadMembers()}>
              Load more assignees
            </Button>
          ) : null}
          <h3>Subtasks</h3>
          {edit ? (
            <CreateTaskForm
              subtask
              pending={pending}
              onCreate={(title) => mutate(`${base}/tasks/${taskId}/subtasks`, 'POST', { title })}
            />
          ) : null}
          {data.children.items.length === 0 ? <p>No subtasks yet.</p> : null}
          <ul className="subtask-list">
            {data.children.items.map((child) => (
              <li key={child.id}>
                <h4>{child.title}</h4>
                <p>
                  {statusLabels[child.status]} · {child.assigneeName ?? 'Unassigned'}
                </p>
                {editingChild === child.id && edit ? (
                  <TaskEditor
                    key={child.version}
                    task={child}
                    permissions={data.permissions}
                    userId={userId}
                    members={members}
                    pending={pending}
                    onSave={(input) =>
                      void mutate(`${base}/tasks/${taskId}/subtasks/${child.id}`, 'PATCH', input)
                    }
                  />
                ) : (
                  <p className="project-description">{child.description}</p>
                )}
                {edit ? (
                  <Button
                    variant="secondary"
                    disabled={pending}
                    onClick={() => setEditingChild(editingChild === child.id ? null : child.id)}
                  >
                    {editingChild === child.id ? 'Hide subtask editor' : `Edit ${child.title}`}
                  </Button>
                ) : null}
                {edit && data.permissions.deleteTasks ? (
                  <Button variant="ghost" disabled={pending} onClick={() => setDeleting(child)}>
                    Delete subtask
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="project-toolbar">
            {offset > 0 ? (
              <Button disabled={pending} onClick={() => setOffset(Math.max(0, offset - 50))}>
                Previous subtasks
              </Button>
            ) : null}
            {data.children.nextOffset !== null ? (
              <Button disabled={pending} onClick={() => setOffset(data.children.nextOffset ?? 0)}>
                Next subtasks
              </Button>
            ) : null}
          </div>
          {edit && data.permissions.deleteTasks ? (
            <Button variant="ghost" disabled={pending} onClick={() => setDeleting(data.task)}>
              Delete task
            </Button>
          ) : null}
        </>
      ) : null}
      {deleting ? (
        <ConfirmDelete
          label={deleting.title}
          pending={pending}
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            const root = deleting.id === taskId;
            void mutate(
              root ? `${base}/tasks/${taskId}` : `${base}/tasks/${taskId}/subtasks/${deleting.id}`,
              'DELETE',
            ).then((ok) => {
              setDeleting(null);
              if (ok && root) onClose();
            });
          }}
        />
      ) : null}
    </dialog>
  );
}
