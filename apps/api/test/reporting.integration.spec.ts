import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { WorkspaceService } from '../src/workspaces/workspace.service.js';
import { WorkspaceInvitationService } from '../src/workspaces/workspace-invitation.service.js';
import { AccountMailDelivery, type AccountMail } from '../src/auth/account-mail.service.js';
import { ProjectService } from '../src/projects/project.service.js';
import { CollaborationService } from '../src/collaboration/collaboration.service.js';
import { ReportingService } from '../src/reporting/reporting.service.js';
import { ReportingScope } from '../src/reporting/reporting.repository.js';
import { reportQuery } from '../src/reporting/reporting.schemas.js';
import { auditQuery } from '../src/audit/audit.schemas.js';
import { AuditWriter } from '../src/audit/audit.writer.js';
import { AiProvider } from '../src/ai/ai.provider.js';
import { TestAiProvider } from '../src/ai/test.provider.js';
import { AiService } from '../src/ai/ai.service.js';
import { breakdownOutput } from '../src/ai/ai.schemas.js';

describe('PostgreSQL analytics, exports and immutable audit', () => {
  let app: INestApplication;
  let db: PrismaService;
  let projects: ProjectService;
  let reporting: ReportingService;
  let owner: { id: string; token: string };
  let member: { id: string; token: string };
  let w: string;
  let foreign: string;
  let p: string;
  let foreignProject: string;
  let url: string;
  const users: string[] = [];
  const spaces: string[] = [];
  const mail: AccountMail[] = [];
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiProvider)
      .useValue(new TestAiProvider())
      .overrideProvider(AccountMailDelivery)
      .useValue({
        assertAvailable() {},
        send(message: AccountMail) {
          mail.push(message);
          return Promise.resolve();
        },
      })
      .compile();
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
    db = app.get(PrismaService);
    projects = app.get(ProjectService);
    reporting = app.get(ReportingService);
  });
  async function account() {
    const value = await app.get(AuthService).register({
      name: 'Report tester',
      email: `report-${randomUUID()}@example.com`,
      password: 'report-test-password-42',
    });
    users.push(value.user.id);
    return { id: value.user.id, token: value.token };
  }
  beforeEach(async () => {
    owner = await account();
    member = await account();
    w = (await app.get(WorkspaceService).create(owner.id, 'Report workspace')).id;
    foreign = (await app.get(WorkspaceService).create(member.id, 'Foreign')).id;
    spaces.push(w, foreign);
    await db.workspaceMembership.create({
      data: { workspaceId: w, userId: member.id, role: 'Member' },
    });
    p = (await projects.create(w, owner.id, { name: 'Release', description: 'Project metadata' }))
      .id;
    foreignProject = (
      await projects.create(foreign, member.id, { name: 'Foreign private report', description: '' })
    ).id;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    mail.length = 0;
    await db.workspace.deleteMany({ where: { id: { in: spaces.splice(0) } } });
    await db.user.deleteMany({ where: { id: { in: users.splice(0) } } });
    // Audit tombstones intentionally survive; no privileged trigger bypass for test cleanup.
  });
  afterAll(async () => {
    await app?.close();
  });
  const get = (path: string, user = owner) =>
    request(url).get(path).set('Cookie', `platform_session=${user.token}`);
  const report = (projectId?: string) =>
    reporting.report(w, owner.id, reportQuery.parse({ range: '7d' }), projectId);
  const audit = (query = {}) => reporting.audit(w, owner.id, auditQuery.parse(query));
  const task = (title = 'Work', parentId: string | null = null, assigneeId?: string) =>
    projects.createTask(w, owner.id, p, parentId, { title, description: '', assigneeId });

  it('aggregates roots, subtasks, archived projects, member/unassigned workload and UTC event trends', async () => {
    const root = await task('Root', null, member.id);
    const child = await task('Child', root.id, owner.id);
    await task('Unassigned');
    await projects.updateTask(w, owner.id, p, root.id, null, { version: 1, status: 'DONE' });
    await projects.updateTask(w, owner.id, p, child.id, root.id, {
      version: 1,
      status: 'IN_PROGRESS',
    });
    const archived = await projects.create(w, owner.id, { name: 'Archive', description: '' });
    await projects.createTask(w, owner.id, archived.id, null, {
      title: 'Archived work',
      description: '',
    });
    await projects.update(w, owner.id, archived.id, { archived: true });
    const result = await report();
    expect(result.projects).toMatchObject({ active: 1, archived: 1, total: 2 });
    expect(result.tasks).toEqual({
      TODO: 2,
      IN_PROGRESS: 0,
      DONE: 1,
      total: 3,
      completionPercent: 33.3,
    });
    expect(result.subtasks).toMatchObject({ total: 1, IN_PROGRESS: 1 });
    expect(result.workload.find((row) => row.userId === member.id)).toMatchObject({
      tasks: 1,
      done: 1,
      open: 0,
    });
    expect(result.workload.find((row) => row.userId === null)).toMatchObject({ tasks: 2, open: 2 });
    expect(result.trend).toHaveLength(7);
    expect(result.trend.at(-1)).toMatchObject({ created: 4, completed: 1 });
    const scoped = await report(p);
    expect(scoped.tasks.total).toBe(2);
    expect(scoped.project).toMatchObject({ name: 'Release', description: 'Project metadata' });
    expect(JSON.stringify(result)).not.toContain('Foreign private');
  });
  it('counts completion transitions, including reopened work, without inventing historical snapshots', async () => {
    const root = await task();
    for (const [version, status] of [
      [1, 'DONE'],
      [2, 'TODO'],
      [3, 'DONE'],
    ] as const)
      await projects.updateTask(w, owner.id, p, root.id, null, { version, status });
    const result = await report();
    expect(result.tasks.DONE).toBe(1);
    expect(result.trend.at(-1)?.completed).toBe(2);
    await db.activity.updateMany({
      where: { workspaceId: w, type: 'TASK_CREATED' },
      data: { createdAt: new Date(Date.now() - 8 * 86400000) },
    });
    expect((await report()).trend.reduce((sum, row) => sum + row.created, 0)).toBe(0);
    expect(
      (await reporting.report(w, owner.id, reportQuery.parse({ range: '30d' }))).trend.reduce(
        (sum, row) => sum + row.created,
        0,
      ),
    ).toBe(1);
  });
  it.each(['Owner', 'Admin', 'Manager', 'Member', 'Viewer'] as const)(
    'allows %s reports/exports and restricts audit reads to Owner/Admin',
    async (role) => {
      if (role !== 'Owner')
        await db.workspaceMembership.update({
          where: { workspaceId_userId: { workspaceId: w, userId: member.id } },
          data: { role },
        });
      const actor = role === 'Owner' ? owner : member;
      for (const suffix of [
        'analytics',
        'report',
        'report.csv',
        `projects/${p}/analytics`,
        `projects/${p}/report`,
        `projects/${p}/report.csv`,
      ])
        await get(`/workspaces/${w}/${suffix}`, actor).expect(200);
      await get(`/workspaces/${w}/audit`, actor).expect(
        role === 'Owner' || role === 'Admin' ? 200 : 403,
      );
    },
  );
  it('denies missing/removed memberships and cross-workspace project/export substitutions', async () => {
    for (const suffix of ['analytics', 'report.csv', 'audit']) {
      await request(url).get(`/workspaces/${w}/${suffix}`).expect(401);
      await get(`/workspaces/${foreign}/${suffix}`).expect(404);
    }
    for (const suffix of ['analytics', 'report', 'report.csv'])
      await get(`/workspaces/${w}/projects/${foreignProject}/${suffix}`).expect(404);
    await app.get(WorkspaceService).changeMember(w, owner.id, member.id);
    for (const suffix of ['analytics', 'report.csv', 'audit'])
      await get(`/workspaces/${w}/${suffix}`, member).expect(404);
  });
  it('exports real data with fixed filenames, formula protection, and no sensitive audit payloads', async () => {
    await projects.update(w, owner.id, p, {
      name: '=SUM(A1),"private"',
      description: 'metadata\nsecond line',
    });
    const response = await get(`/workspaces/${w}/projects/${p}/report.csv`).expect(200);
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="project-report.csv"',
    );
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.text).toContain('"\'=SUM(A1),""private"""');
    expect(response.text).toContain('"metadata\nsecond line"');
    expect(response.text).not.toContain('Foreign private');
    const result = await audit();
    expect(JSON.stringify(result)).not.toMatch(
      /SUM\(A1\)|metadata\\n|password|cookie|token|email|dedupKey/,
    );
  });
  it('records project/task/subtask changes, comments and approved AI apply without changing Activity behavior', async () => {
    const root = await task('Sensitive task title', null, member.id);
    const child = await task('Sensitive child', root.id);
    await projects.update(w, owner.id, p, { description: 'Sensitive project body' });
    await projects.update(w, owner.id, p, { archived: true });
    await projects.update(w, owner.id, p, { archived: false });
    await projects.updateTask(w, owner.id, p, root.id, null, {
      version: 1,
      description: 'Sensitive task body',
      status: 'DONE',
      assigneeId: owner.id,
    });
    const params = { workspaceId: w, projectId: p, taskId: root.id };
    const comments = app.get(CollaborationService);
    const comment = await comments.create(params, owner.id, {
      body: 'Secret comment body',
      requestId: randomUUID(),
    });
    await comments.change({ ...params, commentId: comment.id }, owner.id, {
      version: 1,
      body: 'Secret edited body',
    });
    await comments.change({ ...params, commentId: comment.id }, owner.id, { version: 2 });
    const preview = await app.get(AiService).generate(params, owner.id, randomUUID(), 'BREAKDOWN');
    const apply = {
      requestId: preview.requestId,
      subtasks: breakdownOutput.parse(preview.suggestion).subtasks,
    };
    await projects.applyBreakdown(params, owner.id, apply);
    await projects.applyBreakdown(params, owner.id, apply);
    await projects.deleteTask(w, owner.id, p, child.id, root.id);
    const result = await audit({ limit: 100 });
    expect(result.items.map((event) => event.action)).toEqual(
      expect.arrayContaining([
        'PROJECT_CREATED',
        'PROJECT_UPDATED',
        'PROJECT_ARCHIVED',
        'PROJECT_RESTORED',
        'TASK_CREATED',
        'TASK_UPDATED',
        'TASK_ASSIGNED',
        'TASK_STATUS_CHANGED',
        'TASK_DELETED',
        'COMMENT_CREATED',
        'COMMENT_UPDATED',
        'COMMENT_DELETED',
        'AI_BREAKDOWN_APPLIED',
      ]),
    );
    expect(result.items.filter((event) => event.action === 'AI_BREAKDOWN_APPLIED')).toHaveLength(1);
    expect(result.items.find((event) => event.action === 'COMMENT_CREATED')?.entityId).toBe(
      comment.id,
    );
    expect(result.items.find((event) => event.entityId === child.id)?.entityType).toBe('SUBTASK');
    expect(JSON.stringify(result)).not.toMatch(
      /Sensitive|Secret|Test suggestion|Define acceptance/,
    );
    const before = await db.auditEvent.count({ where: { workspaceId: w } });
    await report();
    await audit();
    await get(`/workspaces/${w}/report.csv`).expect(200);
    expect(await db.auditEvent.count({ where: { workspaceId: w } })).toBe(before);
    expect(await db.activity.count({ where: { workspaceId: w, type: 'COMMENT_CREATED' } })).toBe(1);
  });
  it('audits governance, invitation delivery/acceptance and deletion tombstones transactionally', async () => {
    const workspaces = app.get(WorkspaceService);
    const invitations = app.get(WorkspaceInvitationService);
    await workspaces.rename(w, owner.id, 'Private workspace name');
    await workspaces.changeMember(w, owner.id, member.id, 'Viewer');
    await workspaces.changeMember(w, owner.id, member.id);
    const email = (await db.user.findUniqueOrThrow({ where: { id: member.id } })).email;
    const invitation = await invitations.invite(w, owner.id, email, 'Member');
    await invitations.accept(member.id, mail.at(-1)!.url.split('#invite=')[1]!);
    await workspaces.leave(w, member.id);
    const revoked = await invitations.invite(w, owner.id, 'another@example.com', 'Viewer');
    await invitations.revoke(w, owner.id, revoked.id);
    expect((await audit()).items.map((event) => event.action)).toEqual(
      expect.arrayContaining([
        'WORKSPACE_CREATED',
        'WORKSPACE_UPDATED',
        'MEMBER_ROLE_CHANGED',
        'MEMBER_REMOVED',
        'INVITATION_ISSUED',
        'INVITATION_ACCEPTED',
        'MEMBER_LEFT',
        'INVITATION_REVOKED',
      ]),
    );
    expect(JSON.stringify(await audit())).not.toContain(email);
    expect((await audit()).items.some((event) => event.entityId === invitation.id)).toBe(true);
    await workspaces.delete(w, owner.id);
    expect(
      await db.auditEvent.findFirst({ where: { workspaceId: w, action: 'WORKSPACE_DELETED' } }),
    ).toMatchObject({ actorUserId: owner.id });
    await get(`/workspaces/${w}/audit`).expect(404);
  });
  it('rejects audit UPDATE/DELETE/TRUNCATE and exposes no mutation API', async () => {
    const event = await db.auditEvent.findFirstOrThrow({ where: { workspaceId: w } });
    await expect(
      db.auditEvent.update({ where: { id: event.id }, data: { action: 'CHANGED' } }),
    ).rejects.toThrow();
    await expect(db.auditEvent.delete({ where: { id: event.id } })).rejects.toThrow();
    await expect(db.$executeRaw`TRUNCATE audit_events`).rejects.toThrow('append-only');
    await request(url)
      .post(`/workspaces/${w}/audit`)
      .set('Cookie', `platform_session=${owner.token}`)
      .set('Origin', 'http://localhost:5173')
      .send({ action: 'PROJECT_CREATED' })
      .expect(404);
    expect(await db.auditEvent.findUnique({ where: { id: event.id } })).toEqual(event);
  });
  it('rolls back domain writes, activity and audit together on failure', async () => {
    const before = await db.auditEvent.count({ where: { workspaceId: w } });
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Rebound with apply in the injected failure below.
    const original = AuditWriter.prototype.record;
    vi.spyOn(AuditWriter.prototype, 'record').mockImplementation(async function (
      this: AuditWriter,
      ...args
    ) {
      await original.apply(this, args);
      throw new Error('Audit transaction failure');
    });
    await expect(task()).rejects.toThrow('Audit transaction failure');
    expect(await db.task.count({ where: { workspaceId: w } })).toBe(0);
    expect(await db.activity.count({ where: { workspaceId: w, type: 'TASK_CREATED' } })).toBe(0);
    expect(await db.auditEvent.count({ where: { workspaceId: w } })).toBe(before);
  });
  it('supports stable keyset pagination with tied timestamps, filters and concurrent inserts', async () => {
    const stamp = new Date();
    const prefix = randomUUID().slice(0, 24);
    await db.auditEvent.createMany({
      data: Array.from({ length: 5 }, (_, index) => ({
        id: `${prefix}${String(index + 1).padStart(12, '0')}`,
        workspaceId: w,
        actorUserId: owner.id,
        action: 'TASK_UPDATED',
        entityType: 'TASK',
        entityId: randomUUID(),
        metadata: {},
        dedupKey: randomUUID(),
        createdAt: stamp,
      })),
    });
    const first = await audit({
      action: 'TASK_UPDATED',
      actorUserId: owner.id,
      entityType: 'TASK',
      limit: 2,
    });
    expect(first.items.map((item) => item.id.slice(-1))).toEqual(['5', '4']);
    await db.auditEvent.create({
      data: {
        workspaceId: w,
        actorUserId: owner.id,
        action: 'TASK_UPDATED',
        entityType: 'TASK',
        entityId: randomUUID(),
        metadata: {},
        dedupKey: randomUUID(),
        createdAt: new Date(stamp.getTime() + 1000),
      },
    });
    const second = await audit({ action: 'TASK_UPDATED', limit: 2, cursor: first.nextCursor });
    expect(second.items.map((item) => item.id.slice(-1))).toEqual(['3', '2']);
    expect((await audit({ action: 'TASK_UPDATED', actorUserId: member.id })).items).toEqual([]);
    const today = stamp.toISOString().slice(0, 10);
    expect((await audit({ from: today, to: today, action: 'TASK_UPDATED' })).items).toHaveLength(6);
  });
  it('validates query bounds and keeps SQL/provider errors private', async () => {
    for (const query of ['range=1y', 'offset=-1', 'secret=x'])
      await get(`/workspaces/${w}/report?${query}`).expect(400);
    for (const query of [
      'limit=101',
      'actorUserId=bad',
      'action=UNKNOWN',
      'cursor=bad',
      'from=2026-01-01&to=2026-12-01',
    ])
      await get(`/workspaces/${w}/audit?${query}`).expect(400);
    vi.spyOn(ReportingScope.prototype, 'read').mockRejectedValueOnce(
      new Error('Secret SQL credentials'),
    );
    await get(`/workspaces/${w}/report`)
      .expect(500)
      .expect((response) => expect(response.text).not.toContain('Secret'));
  });
  it('uses fixed query counts and bounded roster/project pages as data grows; the audit index exists', async () => {
    const measured = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
      log: [{ emit: 'event', level: 'query' }],
    });
    const queries: string[] = [];
    measured.$on('query', (event) => {
      if (/^\s*(SELECT|WITH)/i.test(event.query)) queries.push(event.query);
    });
    try {
      const sizes: number[] = [];
      for (const count of [0, 200]) {
        if (count)
          await db.task.createMany({
            data: Array.from({ length: count }, (_, i) => ({
              workspaceId: w,
              projectId: p,
              title: `Measured ${i}`,
            })),
          });
        queries.length = 0;
        await measured.$transaction((tx) => new ReportingScope(tx, w).read(reportQuery.parse({})));
        sizes.push(queries.length);
      }
      expect(sizes[0]).toBe(sizes[1]);
      expect(sizes[0]).toBe(5);
      await db.project.createMany({
        data: Array.from({ length: 51 }, (_, i) => ({ workspaceId: w, name: `Page ${i}` })),
      });
      const first = await report();
      const next = await reporting.report(w, owner.id, reportQuery.parse({ offset: 50 }));
      expect(first.projects.items).toHaveLength(50);
      expect(first.page.nextOffset).toBe(50);
      expect(next.projects.items).toHaveLength(2);
      expect(next.page.nextOffset).toBeNull();
      expect(
        new Set([...first.projects.items, ...next.projects.items].map((item) => item.id)).size,
      ).toBe(52);
      const indexes = await db.$queryRaw<
        { indexname: string }[]
      >`SELECT indexname FROM pg_indexes WHERE tablename = 'audit_events' AND schemaname = 'public'`;
      expect(indexes.map((row) => row.indexname)).toContain(
        'audit_events_workspace_id_created_at_id_idx',
      );
    } finally {
      await measured.$disconnect();
    }
  });
});
