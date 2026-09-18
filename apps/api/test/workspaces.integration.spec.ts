import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AccountMailDelivery, type AccountMail } from '../src/auth/account-mail.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import { SessionTokenService } from '../src/auth/session-token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import type { WorkspaceRole } from '../src/generated/prisma/client.js';
import { WorkspaceService } from '../src/workspaces/workspace.service.js';
import { WorkspaceInvitationService } from '../src/workspaces/workspace-invitation.service.js';
import { WorkspaceRepository } from '../src/workspaces/workspace.repository.js';
import { invitationInput } from '../src/workspaces/workspace.schemas.js';

describe('PostgreSQL workspace tenant boundary', () => {
  let app: INestApplication;
  let db: PrismaService;
  let workspaces: WorkspaceService;
  let invitations: WorkspaceInvitationService;
  let owner: { id: string; email: string; token: string };
  let outsider: { id: string; email: string; token: string };
  let id: string;
  const users: string[] = [];
  const spaces: string[] = [];
  const messages: AccountMail[] = [];
  const delivery = {
    assertAvailable: vi.fn(),
    send: vi.fn((message: AccountMail) => {
      messages.push(message);
      return Promise.resolve();
    }),
  };
  const tokens = new SessionTokenService();

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AccountMailDelivery)
      .useValue(delivery)
      .compile();
    app = module.createNestApplication();
    await app.init();
    db = app.get(PrismaService);
    workspaces = app.get(WorkspaceService);
    invitations = app.get(WorkspaceInvitationService);
  });
  async function account() {
    const email = `workspace-${randomUUID()}@example.com`;
    const result = await app
      .get(AuthService)
      .register({ email, name: 'Workspace Tester', password: 'workspace-password-42' });
    users.push(result.user.id);
    return { id: result.user.id, email, token: result.token };
  }
  async function workspace(userId: string) {
    const result = await workspaces.create(userId, 'Test workspace');
    spaces.push(result.id);
    return result.id;
  }
  async function member(role: WorkspaceRole) {
    const user = await account();
    await db.workspaceMembership.create({ data: { workspaceId: id, userId: user.id, role } });
    return user;
  }
  async function invite(
    role: Exclude<WorkspaceRole, 'Owner'> = 'Member',
    actor = owner,
    email = outsider.email,
  ) {
    const input = invitationInput.parse({ email, role });
    const result = await invitations.invite(id, actor.id, input.email, input.role);
    const mail = messages.at(-1);
    if (!mail) throw new Error('Missing test delivery');
    return { ...result, raw: new URL(mail.url).hash.slice('#invite='.length) };
  }
  function client() {
    // Nest's platform adapter exposes an untyped HTTP server; Supertest validates it.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return request(app.getHttpServer());
  }
  beforeEach(async () => {
    messages.length = 0;
    owner = await account();
    outsider = await account();
    id = await workspace(owner.id);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await db.workspace.deleteMany({ where: { id: { in: spaces.splice(0) } } });
    await db.user.deleteMany({ where: { id: { in: users.splice(0) } } });
  });
  afterAll(async () => {
    await app?.close();
  });

  it('creates the workspace and its only Owner atomically and lists only memberships', async () => {
    expect(await db.workspaceMembership.findMany({ where: { workspaceId: id } })).toMatchObject([
      { userId: owner.id, role: 'Owner' },
    ]);
    expect(await workspaces.list(owner.id)).toMatchObject([{ role: 'Owner', workspace: { id } }]);
    expect(await workspaces.list(outsider.id)).toEqual([]);
  });
  it('rolls back a workspace whose initial membership cannot be created', async () => {
    const brokenId = randomUUID();
    await expect(
      db.$transaction(async (tx) => {
        await tx.workspace.create({ data: { id: brokenId, name: 'Rollback', ownerId: owner.id } });
        await tx.workspaceMembership.create({
          data: { workspaceId: brokenId, userId: randomUUID(), role: 'Owner' },
        });
      }),
    ).rejects.toThrow();
    expect(await db.workspace.findUnique({ where: { id: brokenId } })).toBeNull();
  });
  it('enforces unique membership and owner invariants in PostgreSQL', async () => {
    await expect(
      db.workspaceMembership.create({
        data: { workspaceId: id, userId: owner.id, role: 'Member' },
      }),
    ).rejects.toThrow();
    await expect(
      db.workspaceMembership.create({
        data: { workspaceId: id, userId: outsider.id, role: 'Owner' },
      }),
    ).rejects.toThrow();
    await expect(
      db.workspaceMembership.delete({
        where: { workspaceId_userId: { workspaceId: id, userId: owner.id } },
      }),
    ).rejects.toThrow();
    await expect(
      db.workspaceMembership.update({
        where: { workspaceId_userId: { workspaceId: id, userId: owner.id } },
        data: { role: 'Admin' },
      }),
    ).rejects.toThrow();
    expect((await workspaces.detail(id, owner.id)).role).toBe('Owner');
  });
  it('denies cross-tenant read/write for owners and allows explicit scope for dual members', async () => {
    const otherId = await workspace(outsider.id);
    await expect(workspaces.detail(otherId, owner.id)).rejects.toMatchObject({ status: 404 });
    await expect(workspaces.rename(id, outsider.id, 'Stolen')).rejects.toMatchObject({
      status: 404,
    });
    await expect(workspaces.delete(otherId, owner.id)).rejects.toMatchObject({ status: 404 });
    await db.workspaceMembership.create({
      data: { workspaceId: otherId, userId: owner.id, role: 'Viewer' },
    });
    expect((await workspaces.detail(otherId, owner.id)).workspace.id).toBe(otherId);
    await expect(workspaces.rename(otherId, owner.id, 'No')).rejects.toMatchObject({ status: 403 });
    await workspaces.rename(id, owner.id, 'Own');
    expect((await workspaces.detail(otherId, outsider.id)).workspace.name).toBe('Test workspace');
  });
  it.each(['Manager', 'Member', 'Viewer'] as const)(
    'enforces %s read/leave-only permissions',
    async (role) => {
      const user = await member(role);
      expect((await workspaces.detail(id, user.id)).members.length).toBe(2);
      await expect(workspaces.rename(id, user.id, 'No')).rejects.toMatchObject({ status: 403 });
      await expect(invite('Member', user)).rejects.toMatchObject({ status: 403 });
      await expect(workspaces.delete(id, user.id)).rejects.toMatchObject({ status: 403 });
      await workspaces.leave(id, user.id);
      await expect(workspaces.detail(id, user.id)).rejects.toMatchObject({ status: 404 });
    },
  );
  it('limits Admin management to lower roles and forbids escalation/self changes', async () => {
    const admin = await member('Admin');
    const viewer = await member('Viewer');
    await workspaces.rename(id, admin.id, 'Renamed');
    await workspaces.changeMember(id, admin.id, viewer.id, 'Manager');
    await expect(workspaces.changeMember(id, admin.id, viewer.id, 'Admin')).rejects.toMatchObject({
      status: 403,
    });
    await expect(workspaces.changeMember(id, admin.id, owner.id, 'Member')).rejects.toMatchObject({
      status: 403,
    });
    await expect(workspaces.changeMember(id, admin.id, admin.id, 'Admin')).rejects.toMatchObject({
      status: 403,
    });
    await expect(invite('Admin', admin)).rejects.toMatchObject({ status: 403 });
    const privileged = await invite('Admin');
    await expect(invitations.revoke(id, admin.id, privileged.id)).rejects.toMatchObject({
      status: 403,
    });
    await workspaces.changeMember(id, admin.id, viewer.id);
    await expect(workspaces.detail(id, viewer.id)).rejects.toMatchObject({ status: 404 });
  });
  it('allows Owner to manage Admin but never remove/demote/leave as Owner', async () => {
    const admin = await member('Admin');
    await workspaces.changeMember(id, owner.id, admin.id, 'Viewer');
    await workspaces.changeMember(id, owner.id, admin.id, 'Admin');
    await workspaces.changeMember(id, owner.id, admin.id);
    await expect(workspaces.leave(id, owner.id)).rejects.toMatchObject({ status: 403 });
    await expect(workspaces.changeMember(id, owner.id, owner.id, 'Member')).rejects.toMatchObject({
      status: 403,
    });
  });
  it('normalizes invited email, stores only a hash, and accepts exactly once concurrently', async () => {
    const invitation = await invite('Member', owner, `  ${outsider.email.toUpperCase()}  `);
    expect(invitation.email).toBe(outsider.email);
    const stored = await db.workspaceInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(stored.tokenHash).toBe(tokens.hash(invitation.raw));
    const results = await Promise.allSettled([
      invitations.accept(outsider.id, invitation.raw),
      invitations.accept(outsider.id, invitation.raw),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(
      await db.workspaceMembership.count({ where: { workspaceId: id, userId: outsider.id } }),
    ).toBe(1);
    await expect(invitations.accept(outsider.id, invitation.raw)).rejects.toMatchObject({
      status: 400,
    });
  });
  it.each(['expired', 'revoked', 'wrong recipient'] as const)(
    'rejects %s invitations without membership changes',
    async (state) => {
      const invitation = await invite();
      if (state === 'expired')
        await db.workspaceInvitation.update({
          where: { id: invitation.id },
          data: { expiresAt: new Date(0) },
        });
      if (state === 'revoked') await invitations.revoke(id, owner.id, invitation.id);
      await expect(
        invitations.accept(state === 'wrong recipient' ? owner.id : outsider.id, invitation.raw),
      ).rejects.toMatchObject({ status: 400 });
      expect(await workspaces.list(outsider.id)).toEqual([]);
    },
  );
  it('reissues with cooldown and invalidates the predecessor', async () => {
    const first = await invite();
    await expect(invite()).rejects.toMatchObject({ status: 409 });
    await db.workspaceInvitation.update({
      where: { id: first.id },
      data: { issuedAt: new Date(Date.now() - 61_000) },
    });
    const second = await invite('Viewer');
    await expect(invitations.accept(outsider.id, first.raw)).rejects.toMatchObject({ status: 400 });
    await invitations.accept(outsider.id, second.raw);
    expect((await workspaces.detail(id, outsider.id)).role).toBe('Viewer');
  });
  it('rechecks inviter authority after removal or demotion', async () => {
    const admin = await member('Admin');
    const invitation = await invite('Member', admin);
    await workspaces.changeMember(id, owner.id, admin.id, 'Viewer');
    await expect(invitations.accept(outsider.id, invitation.raw)).rejects.toMatchObject({
      status: 400,
    });
  });
  it('serializes acceptance versus revocation and leaves no half-consumed membership', async () => {
    const invitation = await invite();
    await Promise.allSettled([
      invitations.accept(outsider.id, invitation.raw),
      invitations.revoke(id, owner.id, invitation.id),
    ]);
    const stored = await db.workspaceInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(
      await db.workspaceMembership.count({ where: { workspaceId: id, userId: outsider.id } }),
    ).toBe(stored.consumedAt ? 1 : 0);
    await expect(invitations.accept(outsider.id, invitation.raw)).rejects.toMatchObject({
      status: 400,
    });
  });
  it('rolls back token consumption if membership persistence fails', async () => {
    const invitation = await invite();
    const repository = app.get(WorkspaceRepository);
    const original = repository.locked.bind(repository);
    vi.spyOn(repository, 'locked').mockImplementation((workspaceId, action) =>
      original(workspaceId, async (scope) => {
        vi.spyOn(scope, 'addMember').mockRejectedValueOnce(new Error('Injected write failure'));
        return action(scope);
      }),
    );
    await expect(invitations.accept(outsider.id, invitation.raw)).rejects.toThrow(
      'Injected write failure',
    );
    expect(
      (await db.workspaceInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).consumedAt,
    ).toBeNull();
    expect(await workspaces.list(outsider.id)).toEqual([]);
  });
  it('invalidates failed delivery and forbids Owner invitations', async () => {
    delivery.send.mockRejectedValueOnce(new Error('Transport failed'));
    await expect(invite()).rejects.toMatchObject({ status: 503 });
    expect(
      (
        await db.workspaceInvitation.findUniqueOrThrow({
          where: { workspaceId_email: { workspaceId: id, email: outsider.email } },
        })
      ).revokedAt,
    ).not.toBeNull();
    expect(invitationInput.safeParse({ email: outsider.email, role: 'Owner' }).success).toBe(false);
  });
  it('deletes only the selected workspace and cascades its memberships/invitations', async () => {
    const otherId = await workspace(outsider.id);
    await invite();
    await workspaces.delete(id, owner.id);
    expect(await db.workspaceMembership.count({ where: { workspaceId: id } })).toBe(0);
    expect(await db.workspaceInvitation.count({ where: { workspaceId: id } })).toBe(0);
    expect((await workspaces.detail(otherId, outsider.id)).workspace.id).toBe(otherId);
  });
  it('enforces HTTP authentication, origin, validation and tenant denial without ID disclosure', async () => {
    await client().post('/workspaces').send({ name: 'Anonymous' }).expect(401);
    await client()
      .post('/workspaces')
      .set('Cookie', `platform_session=${owner.token}`)
      .set('Origin', 'https://evil.example')
      .send({ name: 'Unsafe' })
      .expect(403);
    await client()
      .post('/workspaces')
      .set('Cookie', `platform_session=${owner.token}`)
      .send({ name: 'x', userId: outsider.id })
      .expect(400);
    const hidden = await client()
      .get(`/workspaces/${id}`)
      .set('Cookie', `platform_session=${outsider.token}`)
      .expect(404);
    const missing = await client()
      .get(`/workspaces/${randomUUID()}`)
      .set('Cookie', `platform_session=${outsider.token}`)
      .expect(404);
    expect(hidden.body).toEqual(missing.body);
    expect(hidden.headers['cache-control']).toBe('no-store');
    await client()
      .patch(`/workspaces/${id}/members/${owner.id}`)
      .set('Cookie', `platform_session=${owner.token}`)
      .send({ role: 'Owner' })
      .expect(400);
  });
});
