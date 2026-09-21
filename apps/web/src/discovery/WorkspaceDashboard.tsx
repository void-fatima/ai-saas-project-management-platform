import { useCallback } from 'react';
import { Button } from '../components/ui/Button';
import { activityLink, activityText } from '../collaboration/collaboration-api';
import { useCollaborationUpdates } from '../collaboration/use-realtime';
import { statuses, statusLabels } from '../projects/project-api';
import { parseWorkspaces } from '../workspaces/workspace-api';
import { discoveryRequest, parseDashboard, resourceLink } from './discovery-api';
import { useDiscoveryData } from './use-discovery-data';

const readWorkspaces = async (signal: AbortSignal) =>
  parseWorkspaces(await discoveryRequest('', signal));
export function WorkspacePicker({
  workspaceId,
  onSelect,
  label,
}: {
  workspaceId: string;
  onSelect: (id: string) => void;
  label: string;
}) {
  const state = useDiscoveryData('workspaces', readWorkspaces);
  return (
    <div className="workspace-picker">
      {state.loading && !state.data ? <p>Loading workspaces…</p> : null}
      {state.error ? (
        <>
          <p role="alert">{state.error}</p>
          <Button onClick={() => state.reload()}>Retry workspaces</Button>
        </>
      ) : null}
      {state.data?.length ? (
        <label className="form-field">
          {label}
          <select value={workspaceId} onChange={(event) => onSelect(event.target.value)}>
            <option value="">Select a workspace</option>
            {!state.data.some((choice) => choice.workspace.id === workspaceId) && workspaceId ? (
              <option value={workspaceId}>Workspace unavailable</option>
            ) : null}
            {state.data.map(({ workspace }) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>
      ) : state.data ? (
        <p>Create or join a workspace from Workspaces to get started.</p>
      ) : null}
    </div>
  );
}

export function WorkspaceDashboard({
  workspaceId,
  onSelect,
}: {
  workspaceId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="workspace-dashboard" aria-label="Workspace dashboard">
      <header className="section-heading">
        <p className="eyebrow">Your workspace</p>
        <h2>Workspace dashboard</h2>
      </header>
      <WorkspacePicker workspaceId={workspaceId} onSelect={onSelect} label="Dashboard workspace" />
      {workspaceId ? (
        <DashboardData key={workspaceId} workspaceId={workspaceId} />
      ) : (
        <p>Select a workspace to view its projects, tasks and activity.</p>
      )}
    </section>
  );
}

export function DashboardData({ workspaceId }: { workspaceId: string }) {
  const read = useCallback(
    async (signal: AbortSignal) => {
      const data = parseDashboard(await discoveryRequest(`/${workspaceId}/dashboard`, signal));
      if (data.workspaceId !== workspaceId)
        throw new Error('Workspace response is unavailable. Please retry.');
      return data;
    },
    [workspaceId],
  );
  const state = useDiscoveryData(workspaceId, read);
  useCollaborationUpdates(workspaceId, () => state.reload(true));
  const data = state.data;
  return (
    <>
      <div className="project-toolbar">
        <Button
          variant="secondary"
          disabled={state.loading && !data}
          onClick={() => state.reload()}
        >
          Refresh dashboard
        </Button>
        {state.loading ? (
          <p aria-live="polite">{data ? 'Updating overview…' : 'Loading dashboard…'}</p>
        ) : null}
      </div>
      {state.error ? <p role="alert">{state.error}</p> : null}
      {data ? (
        <>
          {!data.projects.total ? (
            <p>No projects yet. Open Projects to create your first project.</p>
          ) : null}
          <dl className="dashboard-metrics">
            <div>
              <dt>Projects</dt>
              <dd>{data.projects.total}</dd>
              <small>
                {data.projects.active} active · {data.projects.archived} archived
              </small>
            </div>
            <div>
              <dt>Tasks in active projects</dt>
              <dd>{data.tasks.total}</dd>
              <small>
                {data.tasks.DONE} of {data.tasks.total} completed
              </small>
            </div>
            <div>
              <dt>Subtasks in active projects</dt>
              <dd>{data.subtasks.total}</dd>
              <small>
                {data.subtasks.DONE} of {data.subtasks.total} completed
              </small>
            </div>
            <div>
              <dt>Assigned to me</dt>
              <dd>{data.assignedToMe.total}</dd>
              <small>Open tasks and subtasks</small>
            </div>
          </dl>
          <section className="dashboard-card">
            <h3>Task status</h3>
            <p>Active projects only. Subtasks are counted separately.</p>
            <table>
              <caption className="sr-only">Task and subtask status counts</caption>
              <thead>
                <tr>
                  <th scope="col">Status</th>
                  <th scope="col">Tasks</th>
                  <th scope="col">Subtasks</th>
                </tr>
              </thead>
              <tbody>
                {statuses.map((status) => (
                  <tr key={status}>
                    <th scope="row">{statusLabels[status]}</th>
                    <td>{data.tasks[status]}</td>
                    <td>{data.subtasks[status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <div className="dashboard-lists">
            <TaskList
              title="Assigned to me"
              items={data.assignedToMe.items}
              workspaceId={workspaceId}
              empty="No open tasks assigned to you in active projects."
            />
            <TaskList
              title="Recently updated tasks"
              items={data.recentTasks}
              workspaceId={workspaceId}
              empty="No tasks in active projects yet."
            />
            <section className="dashboard-card">
              <h3>Recent workspace activity</h3>
              <p>Includes archived and deleted resources.</p>
              {!data.activity.length ? (
                <p>No workspace activity yet.</p>
              ) : (
                <ul>
                  {data.activity.map((activity) => (
                    <li key={activity.id}>
                      <a href={activityLink(activity)}>{activityText(activity)}</a>
                      <time dateTime={activity.createdAt}>
                        {new Date(activity.createdAt).toLocaleString()}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      ) : null}
    </>
  );
}
function TaskList({
  title,
  items,
  workspaceId,
  empty,
}: {
  title: string;
  items: ReturnType<typeof parseDashboard>['recentTasks'];
  workspaceId: string;
  empty: string;
}) {
  return (
    <section className="dashboard-card">
      <h3>{title}</h3>
      {!items.length ? (
        <p>{empty}</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <a href={resourceLink(workspaceId, item)}>{item.title}</a>
              <small>
                {item.parentId ? 'Subtask' : 'Task'} · {statusLabels[item.status]}
              </small>
              <time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString()}</time>
            </li>
          ))}
        </ul>
      )}
      <p className="dashboard-list-note">Up to 8 most recently updated.</p>
    </section>
  );
}
