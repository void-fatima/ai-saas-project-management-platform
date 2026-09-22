import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma, WorkspaceRole } from '../generated/prisma/client.js';
import { WorkspaceSignals } from '../collaboration/workspace-signals.js';
import { AuditWriter } from '../audit/audit.writer.js';

const invitationPublic = {
  id: true,
  email: true,
  role: true,
  issuedAt: true,
  expiresAt: true,
  consumedAt: true,
  revokedAt: true,
} as const;

// A scope is created only inside the locked transaction. Every tenant query binds its workspace ID.
export class WorkspaceScope {
  changed = false;
  markChanged() {
    this.changed = true;
  }
  constructor(
    private readonly tx: Prisma.TransactionClient,
    readonly id: string,
  ) {}
  // Resource repositories inherit this transaction and tenant; membership is checked by WorkspaceAccess.
  bind<T>(factory: (tx: Prisma.TransactionClient, workspaceId: string) => T): T {
    return factory(this.tx, this.id);
  }
  audit(actorId: string | null) {
    return new AuditWriter(this.tx, this.id, actorId);
  }
  workspace() {
    return this.tx.workspace.findUniqueOrThrow({ where: { id: this.id } });
  }
  membership(userId: string) {
    return this.tx.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId: this.id, userId } },
    });
  }
  members() {
    return this.tx.workspaceMembership.findMany({
      where: { workspaceId: this.id },
      orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
      select: { userId: true, role: true, user: { select: { name: true, email: true } } },
    });
  }
  rename(name: string) {
    this.markChanged();
    return this.tx.workspace.update({ where: { id: this.id }, data: { name } });
  }
  delete() {
    this.markChanged();
    return this.tx.workspace.delete({ where: { id: this.id } });
  }
  remove(userId: string) {
    this.markChanged();
    return this.tx.workspaceMembership.delete({
      where: { workspaceId_userId: { workspaceId: this.id, userId } },
    });
  }
  changeRole(userId: string, role: WorkspaceRole) {
    this.markChanged();
    return this.tx.workspaceMembership.update({
      where: { workspaceId_userId: { workspaceId: this.id, userId } },
      data: { role },
    });
  }
  invitations(roles: WorkspaceRole[]) {
    return this.tx.workspaceInvitation.findMany({
      where: {
        workspaceId: this.id,
        role: { in: roles },
        consumedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: invitationPublic,
      orderBy: { issuedAt: 'desc' },
    });
  }
  invitationById(id: string) {
    return this.tx.workspaceInvitation.findFirst({ where: { workspaceId: this.id, id } });
  }
  invitationByEmail(email: string) {
    return this.tx.workspaceInvitation.findUnique({
      where: { workspaceId_email: { workspaceId: this.id, email } },
    });
  }
  invitationByHash(tokenHash: string) {
    return this.tx.workspaceInvitation.findFirst({ where: { workspaceId: this.id, tokenHash } });
  }
  memberByEmail(email: string) {
    return this.tx.workspaceMembership.findFirst({
      where: { workspaceId: this.id, user: { email } },
    });
  }
  issue(data: {
    email: string;
    role: WorkspaceRole;
    tokenHash: string;
    inviterId: string;
    issuedAt: Date;
    expiresAt: Date;
  }) {
    return this.tx.workspaceInvitation.upsert({
      where: { workspaceId_email: { workspaceId: this.id, email: data.email } },
      create: { ...data, workspaceId: this.id },
      update: { ...data, consumedAt: null, revokedAt: null },
      select: invitationPublic,
    });
  }
  revoke(id: string) {
    return this.tx.workspaceInvitation.updateMany({
      where: { workspaceId: this.id, id, consumedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  consume(id: string) {
    return this.tx.workspaceInvitation.updateMany({
      where: {
        workspaceId: this.id,
        id,
        consumedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { consumedAt: new Date() },
    });
  }
  addMember(userId: string, role: WorkspaceRole) {
    this.markChanged();
    return this.tx.workspaceMembership.create({ data: { workspaceId: this.id, userId, role } });
  }
  userEmail(userId: string) {
    return this.tx.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
  }
}

@Injectable()
export class WorkspaceRepository {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WorkspaceSignals) private readonly signals: WorkspaceSignals,
  ) {}
  create(userId: string, name: string) {
    return this.prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: { name, ownerId: userId, memberships: { create: { userId, role: 'Owner' } } },
      });
      await new AuditWriter(tx, workspace.id, userId).record({
        action: 'WORKSPACE_CREATED',
        entityType: 'WORKSPACE',
        entityId: workspace.id,
      });
      return workspace;
    });
  }
  list(userId: string) {
    return this.prisma.workspaceMembership.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'asc' }, { workspaceId: 'asc' }],
      select: { role: true, workspace: true },
    });
  }
  // This is a credential lookup, never a client-supplied tenant authorization bypass.
  invitationWorkspace(tokenHash: string) {
    return this.prisma.workspaceInvitation.findUnique({
      where: { tokenHash },
      select: { workspaceId: true },
    });
  }
  async invalidateDelivery(workspaceId: string, tokenHash: string) {
    await this.locked(workspaceId, (scope) =>
      scope.invitationByHash(tokenHash).then(async (invitation) => {
        if (invitation) {
          await scope.revoke(invitation.id);
          await scope.audit(null).record({
            action: 'INVITATION_DELIVERY_FAILED',
            entityType: 'INVITATION',
            entityId: invitation.id,
          });
        }
      }),
    );
  }
  async locked<T>(workspaceId: string, action: (scope: WorkspaceScope) => Promise<T>): Promise<T> {
    let changed = false;
    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM workspaces WHERE id = ${workspaceId}::uuid FOR UPDATE`;
      if (!rows.length) throw new NotFoundException('Workspace is unavailable.');
      const scope = new WorkspaceScope(tx, workspaceId);
      const value = await action(scope);
      changed = scope.changed;
      return value;
    });
    if (changed) this.signals.publish({ workspaceId });
    return result;
  }
}
