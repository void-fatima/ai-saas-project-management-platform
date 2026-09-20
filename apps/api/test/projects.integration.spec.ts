import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import type { WorkspaceRole } from '../src/generated/prisma/client.js';
import { WorkspaceService } from '../src/workspaces/workspace.service.js';
import { ProjectService } from '../src/projects/project.service.js';
import { ProjectScope } from '../src/projects/project.repository.js';

describe('PostgreSQL Projects, Tasks and Kanban', () => {
  let app: INestApplication;
  let db: PrismaService;
  let service: ProjectService;
  let workspaces: WorkspaceService;
  let owner: { id: string; token: string };
  let outsider: { id: string; token: string };
  let w: string;
  let other: string;
  let p: string;
  let q: string;
  const users: string[] = [];
  const spaces: string[] = [];
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    db = app.get(PrismaService);
    service = app.get(ProjectService);
    workspaces = app.get(WorkspaceService);
  });
  async function account() {
    const result = await app.get(AuthService).register({
      name: 'Project Tester',
      email: `project-${randomUUID()}@example.com`,
      password: 'project-password-42',
    });
    users.push(result.user.id);
    return { id: result.user.id, token: result.token };
  }
  async function member(role: WorkspaceRole) {
    if (role === 'Owner') return owner;
    const user = await account();
    await db.workspaceMembership.create({ data: { workspaceId: w, userId: user.id, role } });
    return user;
  }
  const createTask = (title = 'Task', parent: string | null = null) =>
    service.createTask(w, owner.id, p, parent, { title, description: '' });
  function client() {
    // Nest's adapter exposes an untyped server; Supertest owns that platform boundary.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return request(app.getHttpServer());
  }
  const cookie = (user = owner) => `platform_session=${user.token}`;
  const path = () => `/workspaces/${w}/projects/${p}`;
  beforeEach(async () => {
    owner = await account();
    outsider = await account();
    w = (await workspaces.create(owner.id, 'Projects workspace')).id;
    other = (await workspaces.create(outsider.id, 'Other workspace')).id;
    spaces.push(w, other);
    p = (await service.create(w, owner.id, { name: 'Project A', description: '' })).id;
    q = (await service.create(other, outsider.id, { name: 'Project B', description: '' })).id;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await db.workspace.deleteMany({ where: { id: { in: spaces.splice(0) } } });
    await db.user.deleteMany({ where: { id: { in: users.splice(0) } } });
  });
  afterAll(async () => {
    await app?.close();
  });

  it.each<WorkspaceRole>(['Owner', 'Admin', 'Manager', 'Member', 'Viewer'])(
    'enforces the full %s resource matrix over real HTTP',
    async (role) => {
      const user = await member(role);
      const admin = ['Owner', 'Admin', 'Manager'].includes(role);
      const edit = role !== 'Viewer';
      await client().get(path()).set('Cookie', cookie(user)).expect(200);
      await client().get(`${path()}/tasks`).set('Cookie', cookie(user)).expect(200);
      await client()
        .post(`/workspaces/${w}/projects`)
        .set('Cookie', cookie(user))
        .send({ name: 'Created' })
        .expect(admin ? 201 : 403);
      await client()
        .patch(path())
        .set('Cookie', cookie(user))
        .send({ name: 'Renamed' })
        .expect(admin ? 200 : 403);
      const task = await createTask();
      await client()
        .post(`${path()}/tasks`)
        .set('Cookie', cookie(user))
        .send({ title: 'Created task' })
        .expect(edit ? 201 : 403);
      await client()
        .patch(`${path()}/tasks/${task.id}`)
        .set('Cookie', cookie(user))
        .send({ title: 'Edited', version: task.version })
        .expect(edit ? 200 : 403);
      const latest = await service.task(w, owner.id, p, task.id);
      await client()
        .post(`${path()}/tasks/${task.id}/move`)
        .set('Cookie', cookie(user))
        .send({ status: 'DONE', beforeId: null, version: latest.version })
        .expect(edit ? 200 : 403);
      await client()
        .post(`${path()}/tasks/${task.id}/subtasks`)
        .set('Cookie', cookie(user))
        .send({ title: 'Subtask' })
        .expect(edit ? 201 : 403);
      const child = await createTask('Child permission checks', task.id);
      await client()
        .get(`${path()}/tasks/${task.id}/subtasks/${child.id}`)
        .set('Cookie', cookie(user))
        .expect(200);
      await client()
        .patch(`${path()}/tasks/${task.id}/subtasks/${child.id}`)
        .set('Cookie', cookie(user))
        .send({ title: 'Updated child', version: child.version })
        .expect(edit ? 200 : 403);
      const currentChild = await service.task(w, owner.id, p, child.id, task.id);
      await client()
        .patch(`${path()}/tasks/${task.id}/subtasks/${child.id}`)
        .set('Cookie', cookie(user))
        .send({ assigneeId: owner.id, version: currentChild.version })
        .expect(admin ? 200 : 403);
      await client()
        .delete(`${path()}/tasks/${task.id}/subtasks/${child.id}`)
        .set('Cookie', cookie(user))
        .expect(admin ? 204 : 403);
      await client()
        .delete(`${path()}/tasks/${task.id}`)
        .set('Cookie', cookie(user))
        .expect(admin ? 204 : 403);
      await client()
        .delete(path())
        .set('Cookie', cookie(user))
        .expect(admin ? 204 : 403);
      if (role === 'Manager')
        await client()
          .patch(`/workspaces/${w}`)
          .set('Cookie', cookie(user))
          .send({ name: 'Forbidden governance' })
          .expect(403);
    },
  );
  it('denies anonymous, foreign-workspace and hostile resource ID substitutions', async () => {
    const foreign = await service.createTask(other, outsider.id, q, null, {
      title: 'Foreign',
      description: '',
    });
    await client().get(path()).expect(401);
    const foreignPath = `/workspaces/${other}/projects/${q}`;
    await client().get(foreignPath).set('Cookie', cookie()).expect(404);
    await client().get(`/workspaces/${w}/projects/${q}`).set('Cookie', cookie()).expect(404);
    await client()
      .patch(`/workspaces/${w}/projects/${q}`)
      .set('Cookie', cookie())
      .send({ name: 'No' })
      .expect(404);
    await client().delete(`/workspaces/${w}/projects/${q}`).set('Cookie', cookie()).expect(404);
    await client().get(`/workspaces/${w}/projects/${q}/tasks`).set('Cookie', cookie()).expect(404);
    await client()
      .post(`/workspaces/${w}/projects/${q}/tasks`)
      .set('Cookie', cookie())
      .send({ title: 'No' })
      .expect(404);
    await client().get(`${path()}/tasks/${foreign.id}`).set('Cookie', cookie()).expect(404);
    await client()
      .patch(`${path()}/tasks/${foreign.id}`)
      .set('Cookie', cookie())
      .send({ title: 'No', version: 1 })
      .expect(404);
    await client().delete(`${path()}/tasks/${foreign.id}`).set('Cookie', cookie()).expect(404);
    await client()
      .post(`${path()}/tasks/${foreign.id}/subtasks`)
      .set('Cookie', cookie())
      .send({ title: 'No' })
      .expect(404);
    await client()
      .post(`${path()}/tasks/${foreign.id}/move`)
      .set('Cookie', cookie())
      .send({ status: 'DONE', beforeId: null, version: 1 })
      .expect(404);
    const local = await createTask();
    await expect(
      service.move(w, owner.id, p, local.id, null, {
        version: 1,
        status: 'TODO',
        beforeId: foreign.id,
      }),
    ).rejects.toMatchObject({ status: 404 });
    // Even membership in both workspaces does not make substituted resources valid.
    await db.workspaceMembership.create({
      data: { workspaceId: other, userId: owner.id, role: 'Admin' },
    });
    await expect(service.task(w, owner.id, p, foreign.id)).rejects.toMatchObject({ status: 404 });
  });
  it('allows Member self-assignment only, never replacement or removal of another assignee', async () => {
    const user = await member('Member');
    const task = await createTask();
    let latest = await service.updateTask(w, user.id, p, task.id, null, {
      version: 1,
      assigneeId: user.id,
    });
    expect(latest.assigneeId).toBe(user.id);
    latest = await service.updateTask(w, user.id, p, task.id, null, {
      version: latest.version,
      assigneeId: null,
    });
    await expect(
      service.updateTask(w, user.id, p, task.id, null, {
        version: latest.version,
        assigneeId: owner.id,
      }),
    ).rejects.toMatchObject({ status: 403 });
    latest = await service.updateTask(w, owner.id, p, task.id, null, {
      version: latest.version,
      assigneeId: owner.id,
    });
    for (const assigneeId of [null, user.id])
      await expect(
        service.updateTask(w, user.id, p, task.id, null, { version: latest.version, assigneeId }),
      ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.createTask(w, user.id, p, null, {
        title: 'No',
        description: '',
        assigneeId: owner.id,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it.each(['remove', 'leave'])(
    'clears task/subtask assignments and revokes subsequent access on %s',
    async (mode) => {
      const user = await member('Member');
      const root = await createTask();
      const sub = await createTask('Sub', root.id);
      for (const task of [root, sub])
        await service.updateTask(w, owner.id, p, task.id, task.parentId, {
          version: 1,
          assigneeId: user.id,
        });
      if (mode === 'remove') await workspaces.changeMember(w, owner.id, user.id);
      else await workspaces.leave(w, user.id);
      const rows = await db.task.findMany({ where: { workspaceId: w } });
      expect(rows.every((row) => row.assigneeId === null && row.version === 3)).toBe(true);
      await expect(service.tasks(w, user.id, p, null)).rejects.toMatchObject({ status: 404 });
      await expect(
        service.updateTask(w, owner.id, p, root.id, null, { version: 3, assigneeId: user.id }),
      ).rejects.toMatchObject({ status: 400 });
    },
  );
  it('rejects cross-workspace assignment in the service and composite database FK', async () => {
    await expect(
      service.createTask(w, owner.id, p, null, {
        title: 'No',
        description: '',
        assigneeId: outsider.id,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      db.task.create({
        data: { workspaceId: w, projectId: p, title: 'No', assigneeId: outsider.id },
      }),
    ).rejects.toThrow();
    const members = await service.members(w, owner.id);
    expect(members.items).toHaveLength(1);
    expect(Object.keys(members.items[0]?.user ?? {}).sort()).toEqual(['email', 'name']);
  });
  it('enforces project/parent relationships and one level at the database boundary', async () => {
    const root = await createTask();
    const sub = await createTask('Child', root.id);
    const sibling = await service.create(w, owner.id, { name: 'Sibling project', description: '' });
    await expect(
      db.task.create({ data: { workspaceId: w, projectId: q, title: 'Foreign project' } }),
    ).rejects.toThrow();
    await expect(
      db.task.create({
        data: { workspaceId: w, projectId: sibling.id, parentId: root.id, title: 'Wrong project' },
      }),
    ).rejects.toThrow();
    await expect(
      db.task.create({
        data: { workspaceId: other, projectId: q, parentId: root.id, title: 'Wrong workspace' },
      }),
    ).rejects.toThrow();
    await expect(
      db.task.create({
        data: { workspaceId: w, projectId: p, parentId: sub.id, title: 'Grandchild' },
      }),
    ).rejects.toThrow();
    await expect(
      service.createTask(w, owner.id, p, sub.id, { title: 'Grandchild', description: '' }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      db.task.update({ where: { id: root.id }, data: { parentId: sub.id } }),
    ).rejects.toThrow();
    expect(
      (await service.updateTask(w, owner.id, p, sub.id, root.id, { version: 1, status: 'DONE' }))
        .status,
    ).toBe('DONE');
  });
  it('archives/restores without losing tasks and deliberately cascades deletion', async () => {
    const root = await createTask();
    await createTask('Child', root.id);
    await service.update(w, owner.id, p, { archived: true });
    expect((await service.tasks(w, owner.id, p, null)).items).toHaveLength(1);
    await expect(createTask()).rejects.toMatchObject({ status: 409 });
    await expect(service.deleteTask(w, owner.id, p, root.id, null)).rejects.toMatchObject({
      status: 409,
    });
    await service.update(w, owner.id, p, { archived: false });
    await service.deleteTask(w, owner.id, p, root.id, null);
    expect(await db.task.count({ where: { workspaceId: w } })).toBe(0);
    const next = await createTask();
    await createTask('Child', next.id);
    await service.delete(w, owner.id, p);
    expect(await db.task.count({ where: { workspaceId: w } })).toBe(0);
  });
  it('persists status and ordering and serializes concurrent reorders without duplicate positions', async () => {
    const a = await createTask('A');
    const b = await createTask('B');
    const c = await createTask('C');
    const firstRace = await Promise.allSettled([
      service.move(w, owner.id, p, b.id, null, { version: 1, status: 'TODO', beforeId: a.id }),
      service.move(w, owner.id, p, c.id, null, { version: 1, status: 'DONE', beforeId: null }),
    ]);
    expect(firstRace[0]?.status).toBe('fulfilled');
    if (firstRace[1]?.status === 'rejected') {
      const current = await service.task(w, owner.id, p, c.id);
      await service.move(w, owner.id, p, c.id, null, {
        version: current.version,
        status: 'DONE',
        beforeId: null,
      });
    }
    const todo = await service.tasks(w, owner.id, p, null, 0, 'TODO');
    expect(todo.items.map((task) => task.title)).toEqual(['B', 'A']);
    const latest = await service.task(w, owner.id, p, c.id);
    const outcomes = await Promise.allSettled([
      service.move(w, owner.id, p, c.id, null, {
        version: latest.version,
        status: 'TODO',
        beforeId: null,
      }),
      service.move(w, owner.id, p, c.id, null, {
        version: latest.version,
        status: 'IN_PROGRESS',
        beforeId: null,
      }),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const all = (await service.tasks(w, owner.id, p, null)).items;
    expect(new Set(all.map((task) => `${task.status}:${task.position}`)).size).toBe(3);
  });
  it('rolls back column shifts if the subsequent move fails', async () => {
    const a = await createTask('A');
    const b = await createTask('B');
    const before = await db.task.findMany({ where: { workspaceId: w }, orderBy: { id: 'asc' } });
    vi.spyOn(ProjectScope.prototype, 'updateTask').mockRejectedValueOnce(
      new Error('Simulated write failure'),
    );
    await expect(
      service.move(w, owner.id, p, b.id, null, { version: 1, status: 'TODO', beforeId: a.id }),
    ).rejects.toThrow('Simulated');
    expect(await db.task.findMany({ where: { workspaceId: w }, orderBy: { id: 'asc' } })).toEqual(
      before,
    );
  });
  it('bounds lists and pages without leaking another tenant', async () => {
    await db.task.createMany({
      data: Array.from({ length: 52 }, (_, position) => ({
        workspaceId: w,
        projectId: p,
        title: `Task ${position}`,
        position,
      })),
    });
    const first = await service.tasks(w, owner.id, p, null);
    expect(first.items).toHaveLength(50);
    expect(first.nextOffset).toBe(50);
    const second = await service.tasks(w, owner.id, p, null, 50);
    expect(second.items).toHaveLength(2);
    expect(second.nextOffset).toBeNull();
    expect(new Set([...first.items, ...second.items].map((task) => task.id)).size).toBe(52);
  });
  it('rechecks a demoted membership on the next task and project request', async () => {
    const user = await member('Manager');
    const root = await createTask();
    await workspaces.changeMember(w, owner.id, user.id, 'Viewer');
    await client()
      .patch(path())
      .set('Cookie', cookie(user))
      .send({ name: 'Stale role' })
      .expect(403);
    await client()
      .patch(`${path()}/tasks/${root.id}`)
      .set('Cookie', cookie(user))
      .send({ title: 'Stale role', version: 1 })
      .expect(403);
    await client().get(path()).set('Cookie', cookie(user)).expect(200);
  });
  it('workspace deletion cascades assigned projects, tasks and subtasks without crossing tenants', async () => {
    const root = await createTask();
    const child = await createTask('Child', root.id);
    await service.updateTask(w, owner.id, p, child.id, root.id, {
      version: 1,
      assigneeId: owner.id,
    });
    await workspaces.delete(w, owner.id);
    expect(await db.project.count({ where: { workspaceId: w } })).toBe(0);
    expect(await db.task.count({ where: { workspaceId: w } })).toBe(0);
    expect((await service.detail(other, outsider.id, q)).project.id).toBe(q);
  });
  it('validates HTTP payloads, stale versions, CSRF and safe server failures', async () => {
    const task = await createTask();
    for (const body of [
      { title: '' },
      { title: 'x'.repeat(201) },
      { title: 'No', workspaceId: other },
      { title: 'No', assigneeId: 'invalid' },
    ])
      await client().post(`${path()}/tasks`).set('Cookie', cookie()).send(body).expect(400);
    await client()
      .patch(`${path()}/tasks/${task.id}`)
      .set('Cookie', cookie())
      .send({ status: 'CUSTOM', version: 1 })
      .expect(400);
    await client()
      .patch(`${path()}/tasks/${task.id}`)
      .set('Cookie', cookie())
      .send({ title: 'Stale', version: 99 })
      .expect(409);
    await client().get(`${path()}/tasks?offset=-1`).set('Cookie', cookie()).expect(400);
    await client().get(`/workspaces/${w}/projects/not-uuid`).set('Cookie', cookie()).expect(400);
    await client()
      .patch(`${path()}/tasks/${task.id}`)
      .set('Cookie', cookie())
      .set('Origin', 'https://hostile.example')
      .send({ title: 'No', version: 1 })
      .expect(403);
    vi.spyOn(ProjectScope.prototype, 'projects').mockRejectedValueOnce(
      new Error('postgres secret connection'),
    );
    const response = await client()
      .get(`/workspaces/${w}/projects`)
      .set('Cookie', cookie())
      .expect(500);
    expect(JSON.stringify(response.body)).not.toContain('postgres');
    expect(response.headers['cache-control']).toContain('no-store');
  });
});
