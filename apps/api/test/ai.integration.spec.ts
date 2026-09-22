import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { WorkspaceService } from '../src/workspaces/workspace.service.js';
import { ProjectService } from '../src/projects/project.service.js';
import { ProjectScope } from '../src/projects/project.repository.js';
import { AiProvider, AiFailure, type AiResult } from '../src/ai/ai.provider.js';
import { AiService } from '../src/ai/ai.service.js';
import { TestAiProvider } from '../src/ai/test.provider.js';
import { breakdownOutput } from '../src/ai/ai.schemas.js';

describe('PostgreSQL tenant-aware AI assistance', () => {
  let app: INestApplication;
  let db: PrismaService;
  let projects: ProjectService;
  let ai: AiService;
  let owner: { id: string; token: string };
  let member: { id: string; token: string };
  let w: string;
  let foreign: string;
  let p: string;
  let foreignProject: string;
  let taskId: string;
  let url: string;
  const provider = new TestAiProvider();
  const users: string[] = [];
  const spaces: string[] = [];
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiProvider)
      .useValue(provider)
      .compile();
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
    db = app.get(PrismaService);
    projects = app.get(ProjectService);
    ai = app.get(AiService);
  });
  async function account() {
    const result = await app.get(AuthService).register({
      name: 'AI tester',
      email: `ai-${randomUUID()}@example.com`,
      password: 'ai-test-password-42',
    });
    users.push(result.user.id);
    return { id: result.user.id, token: result.token };
  }
  const params = () => ({ workspaceId: w, projectId: p, taskId });
  const base = () => `/workspaces/${w}/projects/${p}/tasks/${taskId}/ai`;
  const post = (path: string, body: object, user = owner) =>
    request(url)
      .post(path)
      .set('Cookie', `platform_session=${user.token}`)
      .set('Origin', 'http://localhost:5173')
      .send(body);
  const generate = (user = owner, id = randomUUID()) =>
    ai.generate(params(), user.id, id, 'BREAKDOWN');
  async function preview() {
    const result = await generate();
    return {
      requestId: result.requestId,
      subtasks: breakdownOutput.parse(result.suggestion).subtasks,
    };
  }
  beforeEach(async () => {
    owner = await account();
    member = await account();
    w = (await app.get(WorkspaceService).create(owner.id, 'AI workspace')).id;
    foreign = (await app.get(WorkspaceService).create(member.id, 'Foreign')).id;
    spaces.push(w, foreign);
    await db.workspaceMembership.create({
      data: { workspaceId: w, userId: member.id, role: 'Member' },
    });
    p = (
      await projects.create(w, owner.id, {
        name: 'Launch',
        description: 'Persisted project description',
      })
    ).id;
    foreignProject = (
      await projects.create(foreign, member.id, {
        name: 'Foreign private project',
        description: '',
      })
    ).id;
    taskId = (
      await projects.createTask(w, owner.id, p, null, {
        title: 'Ship feature',
        description: 'Persisted task context',
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

  it('authenticates HTTP calls, denies Viewer, and rejects foreign references before invoking a provider', async () => {
    const call = vi.spyOn(provider, 'generate');
    await request(url).post(`${base()}/breakdown`).send({ requestId: randomUUID() }).expect(401);
    await post(`${base()}/breakdown`, { requestId: randomUUID(), context: 'injected' }).expect(400);
    await db.workspaceMembership.update({
      where: { workspaceId_userId: { workspaceId: w, userId: member.id } },
      data: { role: 'Viewer' },
    });
    await post(`${base()}/breakdown`, { requestId: randomUUID() }, member).expect(403);
    await post(`/workspaces/${w}/projects/${foreignProject}/ai/summary`, {
      requestId: randomUUID(),
    }).expect(404);
    await post(`/workspaces/${foreign}/projects/${foreignProject}/ai/summary`, {
      requestId: randomUUID(),
    }).expect(404);
    const foreignTask = await projects.createTask(foreign, member.id, foreignProject, null, {
      title: 'Foreign task',
      description: '',
    });
    await post(base().replace(taskId, foreignTask.id) + '/plan', {
      requestId: randomUUID(),
    }).expect(404);
    expect(call).not.toHaveBeenCalled();
  });
  it.each(['Owner', 'Admin', 'Manager', 'Member'] as const)(
    'allows %s to generate persisted-context suggestions without changing tasks/activity',
    async (role) => {
      if (role !== 'Owner')
        await db.workspaceMembership.update({
          where: { workspaceId_userId: { workspaceId: w, userId: member.id } },
          data: { role },
        });
      const actor = role === 'Owner' ? owner : member;
      const before = await db.activity.count({ where: { workspaceId: w } });
      const call = vi.spyOn(provider, 'generate');
      const result = await generate(actor);
      expect(result.suggestion).toHaveProperty('subtasks');
      expect(call.mock.calls[0]?.[0].context).toContain('Persisted task context');
      expect(call.mock.calls[0]?.[0].context).not.toContain('Foreign private');
      expect(await db.task.count({ where: { workspaceId: w } })).toBe(1);
      expect(await db.activity.count({ where: { workspaceId: w } })).toBe(before);
      const receipt = await db.aiRun.findFirstOrThrow({
        where: { workspaceId: w, id: result.requestId },
      });
      expect(receipt).toMatchObject({
        status: 'SUCCEEDED',
        inputTokens: 100,
        outputTokens: 80,
        userId: actor.id,
      });
      expect(JSON.stringify(receipt)).not.toMatch(/Persisted|subtasks|password|secret/);
    },
  );
  it('applies edited validated subtasks atomically with normal ordering, versions, activity and idempotent replay', async () => {
    await projects.createTask(w, owner.id, p, taskId, { title: 'Existing', description: '' });
    const input = await preview();
    input.subtasks[0] = { title: 'Reviewed title', description: 'Human edited' };
    const before = await db.activity.count({ where: { workspaceId: w } });
    await post(`${base()}/breakdown/apply`, input).expect(200, { createdCount: 2 });
    await post(`${base()}/breakdown/apply`, input).expect(200, { createdCount: 2 });
    const children = await projects.tasks(w, owner.id, p, taskId);
    expect(
      children.items.map((item) => [
        item.title,
        item.position,
        item.version,
        item.status,
        item.assigneeId,
      ]),
    ).toEqual([
      ['Existing', 0, 1, 'TODO', null],
      ['Reviewed title', 1, 1, 'TODO', null],
      ['Validate the completed work', 2, 1, 'TODO', null],
    ]);
    expect(await db.activity.count({ where: { workspaceId: w } })).toBe(before + 2);
    input.subtasks[0] = { title: 'Different edits', description: '' };
    await post(`${base()}/breakdown/apply`, input).expect(409);
  });
  it('rejects invalid fields, foreign/user receipt reuse and Viewer apply', async () => {
    const input = await preview();
    await post(`${base()}/breakdown/apply`, {
      ...input,
      subtasks: [{ title: 'Injected', description: '', status: 'DONE', assigneeId: owner.id }],
    }).expect(400);
    await post(`${base()}/breakdown/apply`, input, member).expect(404);
    await post(
      `/workspaces/${foreign}/projects/${foreignProject}/tasks/${taskId}/ai/breakdown/apply`,
      input,
      member,
    ).expect(404);
    await db.workspaceMembership.update({
      where: { workspaceId_userId: { workspaceId: w, userId: member.id } },
      data: { role: 'Viewer' },
    });
    await post(`${base()}/breakdown/apply`, input, member).expect(403);
    expect((await projects.tasks(w, owner.id, p, taskId)).items).toHaveLength(0);
  });
  it('rejects stale, expired and duplicate-title previews and archived projects', async () => {
    const stale = await preview();
    await projects.updateTask(w, owner.id, p, taskId, null, { version: 1, description: 'Changed' });
    await expect(projects.applyBreakdown(params(), owner.id, stale)).rejects.toMatchObject({
      status: 409,
    });
    const expired = await preview();
    await db.aiRun.updateMany({
      where: { workspaceId: w, id: expired.requestId },
      data: { createdAt: new Date(Date.now() - 16 * 60_000) },
    });
    await expect(projects.applyBreakdown(params(), owner.id, expired)).rejects.toMatchObject({
      status: 409,
    });
    const duplicate = await preview();
    await projects.createTask(w, owner.id, p, taskId, {
      title: duplicate.subtasks[0]!.title.toUpperCase(),
      description: '',
    });
    await expect(projects.applyBreakdown(params(), owner.id, duplicate)).rejects.toMatchObject({
      status: 409,
    });
    await projects.update(w, owner.id, p, { archived: true });
    await expect(generate()).rejects.toMatchObject({ status: 409 });
    await expect(projects.applyBreakdown(params(), owner.id, duplicate)).rejects.toMatchObject({
      status: 409,
    });
  });
  it('rolls back all subtasks, activity and apply receipt if the second creation fails', async () => {
    const input = await preview();
    const before = await db.activity.count({ where: { workspaceId: w } });
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Rebound to the scope with apply below.
    const original = ProjectScope.prototype.createTask;
    let calls = 0;
    vi.spyOn(ProjectScope.prototype, 'createTask').mockImplementation(async function (
      this: ProjectScope,
      ...args
    ) {
      const result = await original.apply(this, args);
      if (++calls === 2) throw new Error('simulated transaction failure');
      return result;
    });
    await expect(projects.applyBreakdown(params(), owner.id, input)).rejects.toThrow('simulated');
    expect(await db.task.count({ where: { workspaceId: w, parentId: taskId } })).toBe(0);
    expect(await db.activity.count({ where: { workspaceId: w } })).toBe(before);
    expect(
      await db.aiRun.findFirst({ where: { workspaceId: w, id: input.requestId } }),
    ).toMatchObject({ status: 'SUCCEEDED', appliedHash: null });
  });
  it.each(['remove', 'demote', 'edit'] as const)(
    'reauthorizes after provider work and rejects %s during generation',
    async (change) => {
      let release!: (result: AiResult) => void;
      const call = vi.spyOn(provider, 'generate').mockImplementation(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      const pending = generate(member);
      const assertion = expect(pending).rejects.toMatchObject({
        status: change === 'remove' ? 404 : change === 'demote' ? 403 : 409,
      });
      await vi.waitFor(() => expect(call).toHaveBeenCalled());
      if (change === 'remove') await app.get(WorkspaceService).changeMember(w, owner.id, member.id);
      else if (change === 'demote')
        await db.workspaceMembership.update({
          where: { workspaceId_userId: { workspaceId: w, userId: member.id } },
          data: { role: 'Viewer' },
        });
      else
        await projects.updateTask(w, owner.id, p, taskId, null, {
          version: 1,
          title: 'Changed while generating',
        });
      release({
        output: {
          summary: 'Private suggestion',
          subtasks: [{ title: 'Private', description: '' }],
        },
      });
      await assertion;
      expect(await db.aiRun.findFirst({ where: { workspaceId: w } })).toMatchObject({
        status: 'FAILED',
      });
    },
  );
  it('removed members lose preview-apply access immediately', async () => {
    const result = await generate(member);
    await app.get(WorkspaceService).changeMember(w, owner.id, member.id);
    await post(
      `${base()}/breakdown/apply`,
      { requestId: result.requestId, subtasks: breakdownOutput.parse(result.suggestion).subtasks },
      member,
    ).expect(404);
  });
  it('bounds context and excludes unrelated tasks, members, comments and secrets', async () => {
    await db.task.createMany({
      data: Array.from({ length: 43 }, (_, i) => ({
        id: randomUUID(),
        workspaceId: w,
        projectId: p,
        parentId: taskId,
        creatorId: owner.id,
        title: `Subtask ${i}`,
        description: 'x'.repeat(300),
        position: i,
      })),
    });
    const call = vi.spyOn(provider, 'generate');
    const result = await generate();
    expect(result.contextTruncated).toBe(true);
    const context = call.mock.calls[0]![0].context;
    expect(Buffer.byteLength(context)).toBeLessThanOrEqual(24000);
    const parsed: unknown = JSON.parse(context);
    expect(parsed).toHaveProperty('tasks.length', 40);
    expect(context).not.toMatch(/email|token|password|Foreign private/);
    await post(`/workspaces/${w}/projects/${p}/ai/summary`, { requestId: randomUUID() }).expect(
      200,
    );
    const child = (await projects.tasks(w, owner.id, p, taskId)).items[0]!;
    await post(`${base().replace('/ai', '')}/subtasks/${child.id}/ai/plan`, {
      requestId: randomUUID(),
    }).expect(200);
    await post(`${base().replace('/ai', '')}/subtasks/${child.id}/ai/breakdown`, {
      requestId: randomUUID(),
    }).expect(409);
    await post(
      `${base().replace(taskId, randomUUID()).replace('/ai', '')}/subtasks/${child.id}/ai/plan`,
      { requestId: randomUUID() },
    ).expect(404);
  });
  it('rejects malformed/oversized output and normalizes provider errors without leaking content', async () => {
    const call = vi.spyOn(provider, 'generate');
    call.mockResolvedValueOnce({ output: { summary: 'secret malformed' } });
    await post(`${base()}/breakdown`, { requestId: randomUUID() })
      .expect(502)
      .expect((res) => expect(res.text).not.toContain('secret malformed'));
    call.mockResolvedValueOnce({ output: { summary: 'x'.repeat(24001), subtasks: [] } });
    await post(`${base()}/breakdown`, { requestId: randomUUID() }).expect(502);
    call.mockRejectedValueOnce(new Error('secret provider key'));
    await post(`${base()}/breakdown`, { requestId: randomUUID() })
      .expect(503)
      .expect((res) => expect(res.text).not.toContain('secret provider'));
    call.mockRejectedValueOnce(new AiFailure('timeout'));
    await post(`${base()}/breakdown`, { requestId: randomUUID() }).expect(504);
    expect(await db.task.count({ where: { workspaceId: w } })).toBe(1);
    expect(await db.aiRun.count({ where: { workspaceId: w, status: 'FAILED' } })).toBe(4);
  });
  it('serializes duplicate request reservations and enforces per-user limits before provider calls', async () => {
    const call = vi.spyOn(provider, 'generate');
    const id = randomUUID();
    const results = await Promise.allSettled([generate(owner, id), generate(owner, id)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(call).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i++) await generate();
    await expect(generate()).rejects.toMatchObject({ status: 429 });
    expect(call).toHaveBeenCalledTimes(6);
    await generate(member);
    expect(call).toHaveBeenCalledTimes(7);
  });
  it('enforces workspace hourly and in-flight budgets across users', async () => {
    const call = vi.spyOn(provider, 'generate');
    await db.aiRun.createMany({
      data: Array.from({ length: 4 }, () => ({
        id: randomUUID(),
        workspaceId: w,
        userId: owner.id,
        projectId: p,
        operation: 'SUMMARY',
        provider: 'test',
        model: 'fixture',
      })),
    });
    await expect(generate(member)).rejects.toMatchObject({ status: 429 });
    await db.aiRun.updateMany({
      where: { workspaceId: w },
      data: { createdAt: new Date(Date.now() - 120_000), status: 'FAILED' },
    });
    await db.aiRun.createMany({
      data: Array.from({ length: 56 }, () => ({
        id: randomUUID(),
        workspaceId: w,
        userId: owner.id,
        projectId: p,
        operation: 'SUMMARY',
        provider: 'test',
        model: 'fixture',
        status: 'FAILED',
        createdAt: new Date(Date.now() - 120_000),
      })),
    });
    await expect(generate(member)).rejects.toMatchObject({ status: 429 });
    expect(call).not.toHaveBeenCalled();
  });
});
