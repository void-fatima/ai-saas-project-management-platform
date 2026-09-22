import { Prisma, type TaskStatus } from '../generated/prisma/client.js';
import { ProjectScope } from '../projects/project.repository.js';
import { distribution, period, type ReportQuery } from './reporting.schemas.js';

export interface Workload {
  userId: string | null;
  name: string;
  tasks: number;
  subtasks: number;
  open: number;
  done: number;
}
export interface Trend {
  day: string;
  created: number;
  completed: number;
  activity: number;
}
export class ReportingScope {
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly workspaceId: string,
  ) {}
  async read(query: ReportQuery, projectId?: string, now = new Date()) {
    const project = projectId
      ? await new ProjectScope(this.tx, this.workspaceId).project(projectId)
      : null;
    const window = period(query.range, now);
    const projectFilter = projectId
      ? Prisma.sql`AND project_id = ${projectId}::uuid`
      : Prisma.empty;
    const [states, projects, counts, workload, trends] = await Promise.all([
      this.tx.project.groupBy({
        by: ['archived'],
        where: { workspaceId: this.workspaceId, id: projectId },
        _count: { _all: true },
      }),
      this.tx.project.findMany({
        where: { workspaceId: this.workspaceId, id: projectId },
        select: { id: true, name: true, archived: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: query.offset,
        take: 51,
      }),
      this.tx.$queryRaw<{ subtask: boolean; status: TaskStatus; count: number }[]>(Prisma.sql`
        SELECT (parent_id IS NOT NULL) AS subtask, status, COUNT(*)::int AS count
        FROM tasks WHERE workspace_id = ${this.workspaceId}::uuid ${projectFilter}
        GROUP BY (parent_id IS NOT NULL), status`),
      this.tx.$queryRaw<Workload[]>(Prisma.sql`
        WITH counts AS (
          SELECT assignee_id, COUNT(*) FILTER (WHERE parent_id IS NULL)::int AS tasks,
            COUNT(*) FILTER (WHERE parent_id IS NOT NULL)::int AS subtasks,
            COUNT(*) FILTER (WHERE status <> 'DONE')::int AS open,
            COUNT(*) FILTER (WHERE status = 'DONE')::int AS done
          FROM tasks WHERE workspace_id = ${this.workspaceId}::uuid ${projectFilter} GROUP BY assignee_id
        ), roster AS (
          SELECT m.user_id AS "userId", u.name FROM workspace_memberships m JOIN users u ON u.id = m.user_id
          WHERE m.workspace_id = ${this.workspaceId}::uuid
          UNION ALL SELECT NULL::uuid, 'Unassigned'
        ) SELECT r."userId", r.name, COALESCE(c.tasks, 0)::int AS tasks, COALESCE(c.subtasks, 0)::int AS subtasks,
          COALESCE(c.open, 0)::int AS open, COALESCE(c.done, 0)::int AS done
        FROM roster r LEFT JOIN counts c ON c.assignee_id IS NOT DISTINCT FROM r."userId"
        ORDER BY r."userId" ASC NULLS FIRST OFFSET ${query.offset} LIMIT 51`),
      this.tx.$queryRaw<Trend[]>(Prisma.sql`
        SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
          COUNT(*) FILTER (WHERE type = 'TASK_CREATED')::int AS created,
          COUNT(*) FILTER (WHERE type = 'TASK_STATUS_CHANGED' AND to_status = 'DONE')::int AS completed,
          COUNT(*)::int AS activity
        FROM activities WHERE workspace_id = ${this.workspaceId}::uuid ${projectFilter}
          AND created_at >= ${window.start} AND created_at < ${window.end}
        GROUP BY day ORDER BY day`),
    ]);
    const active = states.find((row) => !row.archived)?._count._all ?? 0;
    const archived = states.find((row) => row.archived)?._count._all ?? 0;
    const byDay = new Map(trends.map((row) => [row.day, row]));
    return {
      workspaceId: this.workspaceId,
      project: project
        ? {
            id: project.id,
            name: project.name,
            description: project.description,
            archived: project.archived,
          }
        : null,
      range: query.range,
      from: window.start.toISOString(),
      toExclusive: window.end.toISOString(),
      generatedAt: now.toISOString(),
      projects: { active, archived, total: active + archived, items: projects.slice(0, 50) },
      tasks: distribution(counts.filter((row) => !row.subtask)),
      subtasks: distribution(counts.filter((row) => row.subtask)),
      workload: workload.slice(0, 50),
      trend: Array.from({ length: window.days }, (_, i) => {
        const day = new Date(window.start.getTime() + i * 86400000).toISOString().slice(0, 10);
        return byDay.get(day) ?? { day, created: 0, completed: 0, activity: 0 };
      }),
      page: {
        offset: query.offset,
        nextOffset: projects.length > 50 || workload.length > 50 ? query.offset + 50 : null,
      },
    };
  }
}
export type Report = Awaited<ReturnType<ReportingScope['read']>>;
