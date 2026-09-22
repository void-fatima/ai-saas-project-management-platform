import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/Button';
import { WorkspacePicker } from '../discovery/WorkspaceDashboard';
import { useProjectData } from '../projects/use-project-data';
import { AuditView } from './AuditView';
import { downloadReport, parseReport, reportingRequest, type Report } from './reporting-api';

export function ReportingPanel({
  workspaceId,
  onSelect,
}: {
  workspaceId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="projects-panel reporting-panel" aria-label="Analytics and reports">
      <h2>Analytics and reports</h2>
      <WorkspacePicker label="Reporting workspace" workspaceId={workspaceId} onSelect={onSelect} />
      {workspaceId ? (
        <ReportingData key={workspaceId} workspaceId={workspaceId} />
      ) : (
        <p>Select a workspace to view analytics and reports.</p>
      )}
    </section>
  );
}
export function ReportingData({ workspaceId }: { workspaceId: string }) {
  return <ScopedReportingData key={workspaceId} workspaceId={workspaceId} />;
}
function ScopedReportingData({ workspaceId }: { workspaceId: string }) {
  const [projectId, setProjectId] = useState('');
  const [range, setRange] = useState('30d');
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState<'analytics' | 'report' | 'audit'>('analytics');
  const base = `/${workspaceId}${projectId ? `/projects/${projectId}` : ''}`;
  const query = `range=${range}&offset=${offset}`;
  const read = useCallback(
    async (signal: AbortSignal) =>
      parseReport(
        await reportingRequest(
          `${base}/${view === 'report' ? 'report' : 'analytics'}?${query}`,
          signal,
        ),
      ),
    [base, query, view],
  );
  const state = useProjectData(read);
  const exportRequest = useRef<AbortController | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [exportError, setExportError] = useState('');
  useEffect(() => {
    setExportError('');
    setDownloading(false);
    return () => {
      exportRequest.current?.abort();
      exportRequest.current = null;
    };
  }, [base, query]);
  async function download() {
    if (exportRequest.current) return;
    const controller = new AbortController();
    exportRequest.current = controller;
    setDownloading(true);
    setExportError('');
    try {
      await downloadReport(
        `${base}/report.csv?${query}`,
        `${projectId ? 'project' : 'workspace'}-report.csv`,
        controller.signal,
      );
    } catch (error: unknown) {
      if (exportRequest.current === controller)
        setExportError(error instanceof Error ? error.message : 'Export failed.');
    } finally {
      if (exportRequest.current === controller) {
        exportRequest.current = null;
        setDownloading(false);
      }
    }
  }
  return (
    <>
      <div className="project-toolbar">
        <Button
          variant={view === 'analytics' ? 'primary' : 'secondary'}
          onClick={() => setView('analytics')}
        >
          Analytics
        </Button>
        <Button
          variant={view === 'report' ? 'primary' : 'secondary'}
          onClick={() => setView('report')}
        >
          Reports
        </Button>
        {state.data?.canAudit ? (
          <Button
            variant={view === 'audit' ? 'primary' : 'secondary'}
            onClick={() => setView('audit')}
          >
            Audit log
          </Button>
        ) : null}
        <Button variant="ghost" disabled={state.loading} onClick={() => void state.reload()}>
          Refresh report data
        </Button>
      </div>
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.loading ? <p role="status">Loading report data…</p> : null}
      {view === 'audit' ? (
        state.data?.canAudit ? (
          <AuditView key={workspaceId} workspaceId={workspaceId} />
        ) : state.data ? (
          <p>Audit access requires Owner or Admin.</p>
        ) : null
      ) : (
        <>
          <label className="form-field">
            Time range
            <select
              value={range}
              onChange={(event) => {
                setRange(event.target.value);
                setOffset(0);
              }}
            >
              {['7d', '30d', '90d'].map((value) => (
                <option key={value} value={value}>
                  {value.slice(0, -1)} days
                </option>
              ))}
            </select>
          </label>
          {projectId ? (
            <Button
              variant="secondary"
              onClick={() => {
                setProjectId('');
                setOffset(0);
              }}
            >
              Workspace report
            </Button>
          ) : null}
          {state.data ? (
            <>
              <h3>
                {state.data.project
                  ? `Project report: ${state.data.project.name}`
                  : 'Workspace report'}
              </h3>
              {state.data.project ? (
                <p className="project-description">
                  {state.data.project.description} ·{' '}
                  {state.data.project.archived ? 'Archived' : 'Active'}
                </p>
              ) : null}
              <p>
                Current totals include archived projects. The selected range applies to UTC daily
                activity, not current totals. Completion events may include work reopened and
                completed again.
              </p>
              {view === 'report' ? (
                <>
                  <Button disabled={downloading} onClick={() => void download()}>
                    Download this report page as CSV
                  </Button>
                  {exportError ? <p role="alert">{exportError}</p> : null}
                  <p>
                    Generated {new Date(state.data.generatedAt).toLocaleString()}. Project and
                    member rows are paginated; totals and daily trends cover the full scope.
                  </p>
                </>
              ) : null}
              <ReportTables
                report={state.data}
                onProject={(id) => {
                  setProjectId(id);
                  setOffset(0);
                  setView('report');
                }}
              />
              <div className="project-toolbar">
                {offset > 0 ? (
                  <Button onClick={() => setOffset(Math.max(0, offset - 50))}>
                    Previous report page
                  </Button>
                ) : null}
                {state.data.page.nextOffset !== null ? (
                  <Button onClick={() => setOffset(state.data?.page.nextOffset ?? 0)}>
                    Next report page
                  </Button>
                ) : null}
              </div>
            </>
          ) : null}
        </>
      )}
    </>
  );
}
function ReportTables({ report, onProject }: { report: Report; onProject: (id: string) => void }) {
  return (
    <>
      <p>
        {report.projects.active} active projects · {report.projects.archived} archived projects
      </p>
      {!report.tasks.total && !report.subtasks.total ? (
        <p>No work items in this scope yet.</p>
      ) : null}
      <div className="report-table">
        <table>
          <caption>Status distribution</caption>
          <thead>
            <tr>
              <th>Work</th>
              <th>To do</th>
              <th>In progress</th>
              <th>Done</th>
              <th>Total</th>
              <th>Completion</th>
            </tr>
          </thead>
          <tbody>
            {(['tasks', 'subtasks'] as const).map((kind) => (
              <tr key={kind}>
                <th>{kind === 'tasks' ? 'Tasks' : 'Subtasks'}</th>
                <td>{report[kind].TODO}</td>
                <td>{report[kind].IN_PROGRESS}</td>
                <td>{report[kind].DONE}</td>
                <td>{report[kind].total}</td>
                <td>{report[kind].completionPercent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!report.project ? (
        <section aria-label="Report projects">
          <h4>Projects on this page</h4>
          {report.projects.items.map((project) => (
            <Button variant="ghost" key={project.id} onClick={() => onProject(project.id)}>
              {project.name} · {project.archived ? 'Archived' : 'Active'}
            </Button>
          ))}
        </section>
      ) : null}
      <div className="report-table">
        <table>
          <caption>Member workload</caption>
          <thead>
            <tr>
              <th>Member</th>
              <th>Tasks</th>
              <th>Subtasks</th>
              <th>Open</th>
              <th>Done</th>
            </tr>
          </thead>
          <tbody>
            {report.workload.map((member) => (
              <tr key={member.userId ?? 'unassigned'}>
                <th>{member.name}</th>
                <td>{member.tasks}</td>
                <td>{member.subtasks}</td>
                <td>{member.open}</td>
                <td>{member.done}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details open={report.range === '7d'}>
        <summary>Daily created work, completion events and activity</summary>
        <div className="report-table">
          <table>
            <caption>Daily trend (UTC)</caption>
            <thead>
              <tr>
                <th>Date</th>
                <th>Created work</th>
                <th>Completion events</th>
                <th>Activity events</th>
              </tr>
            </thead>
            <tbody>
              {report.trend.map((day) => (
                <tr key={day.day}>
                  <th>{day.day}</th>
                  <td>{day.created}</td>
                  <td>{day.completed}</td>
                  <td>{day.activity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
