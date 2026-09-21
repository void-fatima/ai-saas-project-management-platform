import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { WorkspaceService } from '../src/workspaces/workspace.service.js';
import { ProjectService } from '../src/projects/project.service.js';
import { ActivityWriter } from '../src/collaboration/activity.writer.js';
import { DiscoveryService } from '../src/discovery/discovery.service.js';
import { DashboardScope } from '../src/discovery/dashboard.repository.js';
import { SearchScope, searchQuery } from '../src/discovery/search.repository.js';
import { searchInput } from '../src/discovery/discovery.schemas.js';

describe('PostgreSQL dashboard and tenant-scoped search', () => {
  let app: INestApplication;
  let db: PrismaService;
  let projects: ProjectService;
  let discovery: DiscoveryService;
  let owner: { id: string; token: string };
  let viewer: { id: string; token: string };
  let outsider: { id: string; token: string };
  let w: string;
  let foreign: string;
  let p: string;
  let url: string;
  const users: string[] = [];
  const spaces: string[] = [];
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
    db = app.get(PrismaService);
    projects = app.get(ProjectService);
    discovery = app.get(DiscoveryService);
  });
  async function account() {
    const result = await app.get(AuthService).register({
      name: 'Discovery tester',
      email: `discovery-${randomUUID()}@example.com`,
      password: 'discovery-password-42',
    });
    users.push(result.user.id);
    return { id: result.user.id, token: result.token };
  }
  beforeEach(async () => {
    owner = await account();
    viewer = await account();
    outsider = await account();
    w = (await app.get(WorkspaceService).create(owner.id, 'Discovery')).id;
    foreign = (await app.get(WorkspaceService).create(outsider.id, 'Foreign')).id;
    spaces.push(w, foreign);
    await db.workspaceMembership.create({
      data: { workspaceId: w, userId: viewer.id, role: 'Viewer' },
    });
    p = (
      await projects.create(w, owner.id, {
        name: 'Secret launch',
        description: 'Project discovery description',
      })
    ).id;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await db.workspace.deleteMany({ where: { id: { in: spaces.splice(0) } } });
    await db.user.deleteMany({ where: { id: { in: users.splice(0) } } });
  });
  afterAll(async () => {
    await app?.close();
  });
  const cookie = (user = owner) => `platform_session=${user.token}`;
  const search = (q: string, options = {}) =>
    discovery.search(w, owner.id, searchInput.parse({ q, ...options }));
  const task = (title: string, parentId: string | null = null, assigneeId?: string) =>
    projects.createTask(w, owner.id, p, parentId, {
      title,
      description: 'Task discovery description',
      assigneeId,
    });

  it('aggregates persisted active roots and subtasks separately, current-user assignments and bounded activity', async () => {
    const root = await task('Root', null, owner.id);
    await projects.updateTask(w, owner.id, p, root.id, null, { version: 1, status: 'IN_PROGRESS' });
    const child = await task('Child', root.id, owner.id);
    await projects.updateTask(w, owner.id, p, child.id, root.id, { version: 1, status: 'DONE' });
    await task('Viewer task', null, viewer.id);
    const archived = await projects.create(w, owner.id, { name: 'Archived', description: '' });
    await projects.createTask(w, owner.id, archived.id, null, {
      title: 'Hidden workload',
      description: '',
      assigneeId: owner.id,
    });
    await projects.update(w, owner.id, archived.id, { archived: true });
    await projects.create(foreign, outsider.id, { name: 'Foreign secret', description: '' });
    const result = await discovery.dashboard(w, owner.id);
    expect(result.projects).toEqual({ total: 2, active: 1, archived: 1 });
    expect(result.tasks).toEqual({ total: 2, TODO: 1, IN_PROGRESS: 1, DONE: 0 });
    expect(result.subtasks).toEqual({ total: 1, TODO: 0, IN_PROGRESS: 0, DONE: 1 });
    expect(result.assignedToMe.total).toBe(1);
    expect(result.assignedToMe.items.map((item) => item.id)).toEqual([root.id]);
    expect((await discovery.dashboard(w, viewer.id)).assignedToMe.items[0]?.title).toBe(
      'Viewer task',
    );
    expect(result.recentTasks).toHaveLength(3);
    expect(result.activity).toHaveLength(8);
    expect(result.activity.every((item) => item.workspaceId === w)).toBe(true);
    expect(JSON.stringify(result.recentTasks)).not.toContain('Hidden workload');
    expect(JSON.stringify(result)).not.toMatch(/Foreign secret|password|token|email|dedupKey/);
  });
  it('returns honest empty data and denies foreign and removed memberships for both reads', async () => {
    const empty = await discovery.dashboard(foreign, outsider.id);
    expect(empty.projects.total + empty.tasks.total + empty.subtasks.total).toBe(0);
    expect(empty.activity).toEqual([]);
    expect(
      await discovery.search(foreign, outsider.id, searchInput.parse({ q: 'Secret launch' })),
    ).toEqual({ items: [], nextOffset: null });
    for (const route of ['dashboard', 'search?q=Secret%20launch', 'search?q=']) {
      await request(url)
        .get(`/workspaces/${w}/${route}`)
        .set('Cookie', cookie(outsider))
        .expect(404);
    }
    await db.workspaceMembership.delete({
      where: { workspaceId_userId: { workspaceId: w, userId: viewer.id } },
    });
    await expect(discovery.dashboard(w, viewer.id)).rejects.toMatchObject({ status: 404 });
    await expect(
      discovery.search(w, viewer.id, searchInput.parse({ q: '' })),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('matches project, task and subtask titles/descriptions with normalized whitespace and casing', async () => {
    const root = await task('Secret   LAUNCH task');
    const child = await task('Secret launch child', root.id);
    const result = await search('  sEcReT \t launch  ');
    expect(result.items.map((item) => item.kind)).toEqual(['PROJECT', 'SUBTASK', 'TASK']);
    expect(result.items.find((item) => item.id === child.id)?.parentId).toBe(root.id);
    expect((await search('discovery description')).items).toHaveLength(3);
    expect((await search('  ')).items).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(
      /"(?:workspaceId|creatorId|assigneeId|password|token|description)":/,
    );
    expect(result.items.every((item) => item.snippet.length <= 160)).toBe(true);
  });
  it('treats SQL and wildcard input literally and returns plain-text snippets', async () => {
    await task('Literal %_\\ entry');
    expect((await search('%_\\')).items).toHaveLength(1);
    expect((await search("' OR true --")).items).toEqual([]);
    await projects.update(w, owner.id, p, { description: '<script>alert(1)</script> & hello' });
    expect((await search('hello')).items[0]?.snippet).toBe('<script>alert(1)</script> & hello');
  });
  it('ranks exact, prefix, title substring, then description with stable IDs and bounded pagination', async () => {
    const exact = await task('Launch');
    const prefix = await task('Launch plan');
    const contains = await task('New launch plan');
    const description = await task('Unrelated');
    await projects.updateTask(w, owner.id, p, description.id, null, {
      version: 1,
      description: 'launch',
    });
    const first = await search('launch', { limit: 2 });
    expect(first.items.map((item) => item.id)).toEqual([exact.id, prefix.id]);
    expect(first.nextOffset).toBe(2);
    const second = await search('launch', { limit: 2, offset: 2 });
    expect(second.items.map((item) => item.id)).toEqual([contains.id, p]);
    expect((await search('launch', { offset: 4 })).items[0]?.id).toBe(description.id);
    const stamp = new Date('2026-09-01T00:00:00Z');
    await db.task.createMany({
      data: Array.from({ length: 55 }, () => ({
        workspaceId: w,
        projectId: p,
        title: 'Tied match',
        assigneeId: owner.id,
        updatedAt: stamp,
      })),
    });
    const tied = await search('Tied match', { limit: 50 });
    expect(tied.items).toHaveLength(50);
    expect(tied.items.map((item) => item.id)).toEqual(tied.items.map((item) => item.id).sort());
    expect((await search('Tied match', { offset: 50 })).items).toHaveLength(5);
    expect((await search('Tied match')).items).toHaveLength(20);
    const dashboard = await discovery.dashboard(w, owner.id);
    expect(dashboard.recentTasks).toHaveLength(8);
    expect(dashboard.assignedToMe.total).toBe(55);
    expect(dashboard.assignedToMe.items).toHaveLength(8);
    await request(url)
      .get(`/workspaces/${w}/search?q=Tied%20match&limit=1`)
      .set('Cookie', cookie())
      .expect(200)
      .expect(({ text }) => {
        const page: unknown = JSON.parse(text);
        expect(page).toMatchObject({
          items: [expect.objectContaining({ title: 'Tied match' })],
          nextOffset: 1,
        });
      });
  });
  it('excludes archives by default, allows explicit archived results, and never returns deleted resources', async () => {
    const root = await task('Secret launch task');
    await task('Secret launch child', root.id);
    await projects.update(w, owner.id, p, { archived: true });
    expect((await search('Secret launch')).items).toEqual([]);
    expect(
      (await search('Secret launch', { includeArchived: 'true' })).items.map(
        (item) => item.archived,
      ),
    ).toEqual([true, true, true]);
    await projects.update(w, owner.id, p, { archived: false });
    await projects.deleteTask(w, owner.id, p, root.id, null);
    expect((await search('Secret launch')).items.map((item) => item.id)).toEqual([p]);
    await projects.delete(w, owner.id, p);
    expect((await search('Secret launch')).items).toEqual([]);
    expect((await discovery.dashboard(w, owner.id)).activity.length).toBeGreaterThan(0);
  });
  it('does not expose rolled-back tasks or activity through dashboard or search', async () => {
    const before = await discovery.dashboard(w, owner.id);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const record = ActivityWriter.prototype.record;
    vi.spyOn(ActivityWriter.prototype, 'record').mockImplementation(async function (
      this: ActivityWriter,
      ...args
    ) {
      await record.apply(this, args);
      throw new Error('rollback discovery fixture');
    });
    await expect(task('Phantom')).rejects.toThrow('rollback discovery fixture');
    expect(await discovery.dashboard(w, owner.id)).toEqual(before);
    expect((await search('Phantom')).items).toEqual([]);
  });
  it('enforces authentication, Viewer access, UUIDs, strict input limits and safe HTTP errors', async () => {
    for (const route of ['dashboard', 'search?q=Secret']) {
      await request(url).get(`/workspaces/${w}/${route}`).expect(401);
      await request(url).get(`/workspaces/${w}/${route}`).set('Cookie', cookie(viewer)).expect(200);
      await request(url).get(`/workspaces/bad/${route}`).set('Cookie', cookie()).expect(400);
    }
    for (const query of [
      { q: 'a' },
      { q: 'x'.repeat(101) },
      { q: ' '.repeat(201) },
      { limit: 51 },
      { limit: 0 },
      { limit: 1.5 },
      { offset: -1 },
      { offset: 10001 },
      { includeArchived: 'yes' },
      { secret: 'bad' },
      { q: ['a', 'b'] },
    ]) {
      await request(url)
        .get(`/workspaces/${w}/search`)
        .query(query)
        .set('Cookie', cookie())
        .expect(400);
    }
    await request(url)
      .get(`/workspaces/${w}/search?q=%20`)
      .set('Cookie', cookie())
      .expect(200, { items: [], nextOffset: null });
    await request(url)
      .get(`/workspaces/${w}/dashboard?limit=1`)
      .set('Cookie', cookie())
      .expect(400);
    vi.spyOn(DashboardScope.prototype, 'read').mockRejectedValueOnce(
      new Error('SQL password secret'),
    );
    await request(url)
      .get(`/workspaces/${w}/dashboard`)
      .set('Cookie', cookie())
      .expect(500)
      .expect(({ text }) => expect(text).not.toMatch(/SQL|password|secret/));
    vi.spyOn(SearchScope.prototype, 'read').mockRejectedValueOnce(new Error('SQL password secret'));
    await request(url)
      .get(`/workspaces/${w}/search?q=Secret`)
      .set('Cookie', cookie())
      .expect(500)
      .expect(({ text }) => expect(text).not.toMatch(/SQL|password|secret/));
  });
  it('measures a fixed dashboard query count at 1 and 201 tasks and inspects PostgreSQL search plans', async () => {
    await task('Measured');
    const measured = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
      log: [{ emit: 'event', level: 'query' }],
    });
    const queries: string[] = [];
    measured.$on('query', (event) => {
      if (/^SELECT/i.test(event.query)) queries.push(event.query);
    });
    try {
      const counts: number[] = [];
      for (const size of [0, 200]) {
        if (size)
          await db.task.createMany({
            data: Array.from({ length: size }, (_, index) => ({
              workspaceId: w,
              projectId: p,
              title: `Measured ${index}`,
            })),
          });
        queries.length = 0;
        const result = await measured.$transaction((tx) =>
          new DashboardScope(tx, w).read(owner.id),
        );
        counts.push(queries.length);
        expect(result.recentTasks.length).toBeLessThanOrEqual(8);
        expect(queries.every((sql) => sql.includes('workspace_id') || sql.includes('users'))).toBe(
          true,
        );
      }
      expect(counts[0]).toBe(counts[1]);
      expect(counts[0]).toBeLessThanOrEqual(8);
      expect(counts[0]).toBeGreaterThanOrEqual(7);
      const plan = await db.$queryRaw(
        Prisma.sql`EXPLAIN (ANALYZE, FORMAT JSON) ${searchQuery(w, searchInput.parse({ q: 'Measured' }))}`,
      );
      expect(JSON.stringify(plan)).toContain('Limit');
      expect(JSON.stringify(plan)).toContain('workspace_id');
      const recentPlan = await db.$queryRaw`EXPLAIN (ANALYZE, FORMAT JSON)
        SELECT t.id FROM tasks t JOIN projects p ON p.workspace_id = t.workspace_id AND p.id = t.project_id
        WHERE t.workspace_id = ${w}::uuid AND p.workspace_id = ${w}::uuid AND NOT p.archived
        ORDER BY t.updated_at DESC, t.id DESC LIMIT 8`;
      expect(JSON.stringify(recentPlan)).toContain('Limit');
      const indexes = await db.$queryRaw<
        { indexdef: string }[]
      >`SELECT indexdef FROM pg_indexes WHERE indexname = 'tasks_workspace_id_updated_at_id_idx'`;
      expect(indexes[0]?.indexdef).toContain('updated_at DESC, id DESC');
    } finally {
      await measured.$disconnect();
    }
  });
});
