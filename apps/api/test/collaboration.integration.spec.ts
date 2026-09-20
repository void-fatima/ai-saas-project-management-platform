import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { WorkspaceService } from '../src/workspaces/workspace.service.js';
import { ProjectService } from '../src/projects/project.service.js';
import { CollaborationService } from '../src/collaboration/collaboration.service.js';
import { NotificationService } from '../src/collaboration/notification.service.js';
import { ActivityWriter } from '../src/collaboration/activity.writer.js';
import { WorkspaceSignals } from '../src/collaboration/workspace-signals.js';
import { RealtimeService } from '../src/collaboration/realtime.service.js';
import type { CommentParams } from '../src/collaboration/collaboration.schemas.js';
import { sseClient } from './sse-client.js';

describe('PostgreSQL collaboration and real SSE transport', () => {
  let app: INestApplication;
  let db: PrismaService;
  let projects: ProjectService;
  let comments: CollaborationService;
  let notifications: NotificationService;
  let live: RealtimeService;
  let owner: { id: string; token: string };
  let member: { id: string; token: string };
  let outsider: { id: string; token: string };
  let p: CommentParams;
  let foreign: string;
  let url: string;
  const users: string[] = [];
  const spaces: string[] = [];
  const streams: ReturnType<typeof sseClient>[] = [];
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
    db = app.get(PrismaService);
    projects = app.get(ProjectService);
    comments = app.get(CollaborationService);
    notifications = app.get(NotificationService);
    live = app.get(RealtimeService);
  });
  async function account() {
    const result = await app.get(AuthService).register({
      name: 'Collaboration tester',
      email: `collaboration-${randomUUID()}@example.com`,
      password: 'collaboration-password-42',
    });
    users.push(result.user.id);
    return { id: result.user.id, token: result.token };
  }
  beforeEach(async () => {
    owner = await account();
    member = await account();
    outsider = await account();
    const w = await app.get(WorkspaceService).create(owner.id, 'Collaboration');
    const other = await app.get(WorkspaceService).create(outsider.id, 'Foreign');
    spaces.push(w.id, other.id);
    foreign = other.id;
    await db.workspaceMembership.create({
      data: { workspaceId: w.id, userId: member.id, role: 'Member' },
    });
    const project = await projects.create(w.id, owner.id, { name: 'Project', description: '' });
    const task = await projects.createTask(w.id, owner.id, project.id, null, {
      title: 'Task',
      description: '',
      assigneeId: member.id,
    });
    p = { workspaceId: w.id, projectId: project.id, taskId: task.id };
  });
  afterEach(async () => {
    for (const stream of streams.splice(0)) stream.close();
    await live.flush();
    vi.restoreAllMocks();
    await db.workspace.deleteMany({ where: { id: { in: spaces.splice(0) } } });
    await db.user.deleteMany({ where: { id: { in: users.splice(0) } } });
  });
  afterAll(async () => {
    await app?.close();
  });
  const cookie = (user = owner) => `platform_session=${user.token}`;
  const path = () =>
    `/workspaces/${p.workspaceId}/projects/${p.projectId}/tasks/${p.taskId}/comments`;
  const input = (body = 'Hello <script>alert(1)</script>') => ({ body, requestId: randomUUID() });
  async function stream(user = member) {
    const connection = sseClient(`${url}/realtime`, cookie(user));
    streams.push(connection);
    await connection.wait('ready');
    return connection;
  }

  it('persists safe comments, atomic activity and bounded relevant notifications; retries are idempotent', async () => {
    const body = input();
    const [a, b] = await Promise.all([
      comments.create(p, owner.id, body),
      comments.create(p, owner.id, body),
    ]);
    expect(a.id).toBe(b.id);
    const list = await comments.list(p, member.id, 0);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.body).toBe(body.body);
    expect(JSON.stringify(list)).not.toMatch(/password|token|email/);
    expect(
      await db.activity.count({ where: { workspaceId: p.workspaceId, type: 'COMMENT_CREATED' } }),
    ).toBe(1);
    const inbox = await notifications.list(member.id, 0);
    expect(inbox.unreadCount).toBe(2);
    expect(inbox.items.map((n) => n.type).sort()).toEqual(['ASSIGNED', 'COMMENT']);
    expect((await notifications.list(owner.id, 0)).unreadCount).toBe(0);
    expect((await notifications.list(outsider.id, 0)).items).toEqual([]);
    expect(JSON.stringify(inbox)).not.toContain(body.body);
  });
  it('enforces HTTP authentication, UUID/body/pagination validation, Viewer rules and tenant isolation', async () => {
    await request(url).post(path()).send(input()).expect(401);
    for (const body of [
      { body: '', requestId: randomUUID() },
      { body: 'x'.repeat(4001), requestId: randomUUID() },
      { body: 'hello', requestId: 'bad' },
      { ...input(), authorUserId: outsider.id },
    ])
      await request(url).post(path()).set('Cookie', cookie()).send(body).expect(400);
    await request(url).get(`${path()}?offset=-1`).set('Cookie', cookie()).expect(400);
    await request(url).post(path()).set('Cookie', cookie(outsider)).send(input()).expect(404);
    await request(url)
      .get(path().replace(p.workspaceId, foreign))
      .set('Cookie', cookie(outsider))
      .expect(404);
    await db.workspaceMembership.update({
      where: { workspaceId_userId: { workspaceId: p.workspaceId, userId: member.id } },
      data: { role: 'Viewer' },
    });
    await request(url).get(path()).set('Cookie', cookie(member)).expect(200);
    await request(url).post(path()).set('Cookie', cookie(member)).send(input()).expect(403);
    await request(url)
      .get(`/workspaces/${p.workspaceId}/activity`)
      .set('Cookie', cookie(member))
      .expect(200);
    await request(url)
      .get(`/workspaces/${p.workspaceId}/activity`)
      .set('Cookie', cookie(outsider))
      .expect(404);
  });
  it('allows only author edits/deletes, checks version, and preserves deleted request IDs', async () => {
    const body = input();
    const comment = await comments.create(p, member.id, body);
    const route = `${path()}/${comment.id}`;
    await request(url)
      .patch(route)
      .set('Cookie', cookie())
      .send({ body: 'Owner edit', version: 1 })
      .expect(403);
    await request(url).delete(route).set('Cookie', cookie()).send({ version: 1 }).expect(403);
    await request(url)
      .patch(route)
      .set('Cookie', cookie(member))
      .send({ body: 'Updated', version: 1 })
      .expect(200);
    await request(url)
      .patch(route)
      .set('Cookie', cookie(member))
      .send({ body: 'Stale', version: 1 })
      .expect(409);
    await request(url).delete(route).set('Cookie', cookie(member)).send({ version: 2 }).expect(204);
    expect((await comments.list(p, owner.id, 0)).items).toHaveLength(0);
    await expect(comments.create(p, member.id, body)).rejects.toMatchObject({ status: 409 });
    expect((await db.taskComment.findUniqueOrThrow({ where: { id: comment.id } })).body).toBe('');
  });
  it('supports correctly nested subtask comments and denies archived mutation', async () => {
    const child = await projects.createTask(p.workspaceId, owner.id, p.projectId, p.taskId, {
      title: 'Child',
      description: '',
    });
    const nested = { ...p, parentId: p.taskId, taskId: child.id };
    await comments.create(nested, member.id, input());
    await expect(comments.list({ ...p, taskId: child.id }, owner.id, 0)).rejects.toMatchObject({
      status: 404,
    });
    await projects.update(p.workspaceId, owner.id, p.projectId, { archived: true });
    expect((await comments.list(nested, member.id, 0)).canComment).toBe(false);
    await expect(comments.create(nested, owner.id, input())).rejects.toMatchObject({ status: 409 });
  });
  it('rolls back domain writes, notifications and activity and emits no post-commit signal on failure', async () => {
    const signals = vi.spyOn(app.get(WorkspaceSignals), 'publish');
    // Retain the implementation to inject failure after real transactional writes; apply binds this below.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const record = ActivityWriter.prototype.record;
    vi.spyOn(ActivityWriter.prototype, 'record').mockImplementation(async function (
      this: ActivityWriter,
      ...args
    ) {
      await record.apply(this, args);
      throw new Error('database-write-failed');
    });
    const before = await db.activity.count({ where: { workspaceId: p.workspaceId } });
    await request(url)
      .post(path())
      .set('Cookie', cookie())
      .send(input())
      .expect(500)
      .expect(({ text }) => {
        expect(text).not.toContain('database-write-failed');
      });
    expect(await db.taskComment.count({ where: { workspaceId: p.workspaceId } })).toBe(0);
    expect(await db.activity.count({ where: { workspaceId: p.workspaceId } })).toBe(before);
    expect((await notifications.list(member.id, 0)).unreadCount).toBe(1);
    await expect(
      projects.updateTask(p.workspaceId, owner.id, p.projectId, p.taskId, null, {
        version: 1,
        status: 'DONE',
      }),
    ).rejects.toThrow();
    expect((await projects.task(p.workspaceId, owner.id, p.projectId, p.taskId)).status).toBe(
      'TODO',
    );
    expect(signals).not.toHaveBeenCalled();
  });
  it('records meaningful domain transitions without reorder/no-op notification spam', async () => {
    await projects.update(p.workspaceId, owner.id, p.projectId, { name: 'Renamed' });
    await projects.update(p.workspaceId, owner.id, p.projectId, { archived: true });
    await projects.update(p.workspaceId, owner.id, p.projectId, { archived: false });
    let task = await projects.updateTask(p.workspaceId, member.id, p.projectId, p.taskId, null, {
      version: 1,
      title: 'Changed',
      status: 'DONE',
    });
    task = await projects.move(p.workspaceId, member.id, p.projectId, p.taskId, null, {
      version: task.version,
      status: 'DONE',
      beforeId: null,
    });
    await projects.updateTask(p.workspaceId, owner.id, p.projectId, p.taskId, null, {
      version: task.version,
      assigneeId: member.id,
    });
    const history = await comments.activity(p.workspaceId, owner.id, { offset: 0 });
    expect(history.items.map((a) => a.type)).toEqual(
      expect.arrayContaining([
        'PROJECT_CREATED',
        'PROJECT_UPDATED',
        'PROJECT_ARCHIVED',
        'PROJECT_RESTORED',
        'TASK_CREATED',
        'TASK_UPDATED',
        'TASK_STATUS_CHANGED',
        'TASK_ASSIGNED',
      ]),
    );
    expect((await notifications.list(member.id, 0)).unreadCount).toBe(1);
  });
  it('restricts inbox ownership, supports stable read/read-all, and keeps deleted-resource links harmless', async () => {
    await comments.create(p, owner.id, input());
    const inbox = await notifications.list(member.id, 0);
    const id = inbox.items[0]!.id;
    await request(url).get('/notifications').expect(401);
    await request(url).patch(`/notifications/${id}/read`).set('Cookie', cookie()).expect(404);
    await request(url).patch(`/notifications/${id}/read`).set('Cookie', cookie(member)).expect(204);
    const readAt = (await notifications.list(member.id, 0)).items.find((n) => n.id === id)?.readAt;
    await notifications.read(member.id, id);
    expect((await notifications.list(member.id, 0)).items.find((n) => n.id === id)?.readAt).toEqual(
      readAt,
    );
    expect((await notifications.list(member.id, 0)).unreadCount).toBe(1);
    await request(url).post('/notifications/read-all').set('Cookie', cookie(member)).expect(204);
    expect((await notifications.list(member.id, 0)).unreadCount).toBe(0);
    await projects.deleteTask(p.workspaceId, owner.id, p.projectId, p.taskId, null);
    expect((await notifications.list(member.id, 0)).items).toHaveLength(2);
    await request(url).get(path()).set('Cookie', cookie(member)).expect(404);
    expect(
      (await comments.activity(p.workspaceId, member.id, { offset: 0 })).items.some(
        (a) => a.type === 'TASK_DELETED',
      ),
    ).toBe(true);
  });
  it('bounds comment/activity/inbox reads and validates cross-site policy', async () => {
    await db.taskComment.createMany({
      data: Array.from({ length: 52 }, () => ({
        workspaceId: p.workspaceId,
        projectId: p.projectId,
        taskId: p.taskId,
        authorUserId: owner.id,
        body: 'Page',
        requestId: randomUUID(),
      })),
    });
    expect((await comments.list(p, member.id, 0)).items).toHaveLength(50);
    expect((await comments.list(p, member.id, 50)).items).toHaveLength(2);
    const rows = Array.from({ length: 52 }, () => ({
      id: randomUUID(),
      workspaceId: p.workspaceId,
      projectId: p.projectId,
      taskId: p.taskId,
      rootTaskId: p.taskId,
      actorUserId: owner.id,
      type: 'COMMENT_CREATED' as const,
      subject: 'Page',
      dedupKey: randomUUID(),
    }));
    await db.activity.createMany({ data: rows });
    await db.notification.createMany({
      data: rows.map((row) => ({
        workspaceId: p.workspaceId,
        recipientUserId: member.id,
        activityId: row.id,
        type: 'COMMENT' as const,
      })),
    });
    const history = await comments.activity(p.workspaceId, member.id, { offset: 0 });
    expect(history.items).toHaveLength(50);
    expect(history.nextOffset).toBe(50);
    const inbox = await notifications.list(member.id, 0);
    expect(inbox.items).toHaveLength(50);
    expect(inbox.nextOffset).toBe(50);
    expect((await notifications.list(member.id, 50)).items).toHaveLength(3);
    await request(url).get('/realtime').expect(401);
    await request(url)
      .get('/realtime')
      .set('Cookie', cookie())
      .set('Sec-Fetch-Site', 'cross-site')
      .expect(403);
    await request(url)
      .post('/notifications/read-all')
      .set('Cookie', cookie())
      .set('Origin', 'https://foreign.example')
      .expect(403);
  });
  it('streams committed hints to current members, filters foreign tenants, and reconnects to persisted state', async () => {
    await app.get(WorkspaceService).changeMember(p.workspaceId, owner.id, member.id, 'Viewer');
    const allowed = await stream();
    const denied = await stream(outsider);
    const mark = denied.frames.length;
    await comments.create(p, owner.id, input('Realtime persisted comment'));
    await live.flush();
    expect(await allowed.wait('workspace-changed')).toContain(p.workspaceId);
    await live.heartbeat();
    await denied.wait('heartbeat', mark);
    expect(denied.frames.join('')).not.toContain(p.workspaceId);
    allowed.close();
    const again = await stream();
    expect(await again.wait('ready')).toContain('{}');
    expect((await comments.list(p, member.id, 0)).items[0]?.body).toBe(
      'Realtime persisted comment',
    );
    expect((await notifications.list(member.id, 0)).unreadCount).toBe(2);
  });
  it('delivers inbox hints only to their recipient and caps live connections', async () => {
    const recipient = await stream();
    const other = await stream(owner);
    const mark = other.frames.length;
    await notifications.readAll(member.id);
    await live.flush();
    await recipient.wait('notifications-changed');
    await live.heartbeat();
    await other.wait('heartbeat', mark);
    expect(other.frames.slice(mark).join('')).not.toContain('notifications-changed');
    for (let i = 0; i < 4; i++) await stream();
    await request(url).get('/realtime').set('Cookie', cookie(member)).expect(429);
  });
  it('stops protected events and removes notifications immediately after membership removal', async () => {
    const connection = await stream();
    await request(url)
      .delete(`/workspaces/${p.workspaceId}/members/${member.id}`)
      .set('Cookie', cookie())
      .expect(204);
    await live.flush();
    await connection.wait('workspace-access-ended');
    const mark = connection.frames.length;
    await comments.create(p, owner.id, input());
    await live.flush();
    await live.heartbeat();
    await connection.wait('heartbeat', mark);
    expect(connection.frames.slice(mark).join('')).not.toContain('workspace-changed');
    expect((await notifications.list(member.id, 0)).items).toHaveLength(0);
    await request(url).get(path()).set('Cookie', cookie(member)).expect(404);
  });
  it.each(['revoked', 'expired', 'absolute'] as const)(
    'explicitly closes a %s session before protected delivery',
    async (kind) => {
      const connection = await stream();
      await db.session.updateMany({
        where: { userId: member.id },
        data:
          kind === 'revoked'
            ? { revokedAt: new Date() }
            : kind === 'expired'
              ? { expiresAt: new Date(0) }
              : { createdAt: new Date(0) },
      });
      await comments.create(p, owner.id, input());
      await live.flush();
      await connection.wait('session-ended');
      expect(connection.frames.join('')).not.toContain('workspace-changed');
      await request(url).get('/realtime').set('Cookie', cookie(member)).expect(401);
    },
  );
});
