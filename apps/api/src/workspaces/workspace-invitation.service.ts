import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountMailDelivery } from '../auth/account-mail.service.js';
import { SessionTokenService } from '../auth/session-token.service.js';
import type { Environment } from '../config/environment.validation.js';
import type { WorkspaceRole } from '../generated/prisma/client.js';
import { WorkspaceAccess } from './workspace-access.service.js';
import { canAssign, requirePermission } from './workspace.policy.js';
import { WorkspaceRepository } from './workspace.repository.js';

const invalid = () =>
  new BadRequestException(
    'Invitation is invalid, expired, revoked, already used, or belongs to another account.',
  );

@Injectable()
export class WorkspaceInvitationService {
  constructor(
    @Inject(WorkspaceRepository) private readonly repository: WorkspaceRepository,
    @Inject(WorkspaceAccess) private readonly access: WorkspaceAccess,
    @Inject(SessionTokenService) private readonly tokens: SessionTokenService,
    @Inject(AccountMailDelivery) private readonly mail: AccountMailDelivery,
    @Inject(ConfigService) private readonly config: ConfigService<Environment, true>,
  ) {}

  async invite(workspaceId: string, actorId: string, email: string, role: WorkspaceRole) {
    const token = this.tokens.issue();
    const result = await this.access.run(
      workspaceId,
      actorId,
      'manage',
      async (scope, actorRole) => {
        requirePermission(canAssign(actorRole, role));
        const previous = await scope.invitationByEmail(email);
        if (previous) requirePermission(canAssign(actorRole, previous.role));
        if (await scope.memberByEmail(email))
          throw new ConflictException('This account is already a member.');
        const now = new Date();
        if (previous && now.getTime() - previous.issuedAt.getTime() < 60_000)
          throw new ConflictException('Wait a minute before reissuing this invitation.');
        this.mail.assertAvailable();
        const invitation = await scope.issue({
          email,
          role,
          tokenHash: token.hash,
          inviterId: actorId,
          issuedAt: now,
          expiresAt: new Date(now.getTime() + 7 * 86_400_000),
        });
        await scope.audit(actorId).record({
          action: 'INVITATION_ISSUED',
          entityType: 'INVITATION',
          entityId: invitation.id,
          metadata: { toRole: role },
        });
        return invitation;
      },
    );
    try {
      await this.mail.send({
        to: email,
        purpose: 'invite',
        url: `${this.config.get('WEB_ORIGIN', { infer: true })}/#invite=${token.raw}`,
      });
    } catch {
      try {
        await this.repository.invalidateDelivery(workspaceId, token.hash);
      } catch (error: unknown) {
        if (!(error instanceof NotFoundException)) throw error;
      }
      throw new ServiceUnavailableException(
        'Invitation delivery is unavailable. Please retry later.',
      );
    }
    return result;
  }

  async revoke(workspaceId: string, actorId: string, invitationId: string) {
    await this.access.run(workspaceId, actorId, 'manage', async (scope, role) => {
      const invitation = await scope.invitationById(invitationId);
      if (!invitation) throw new NotFoundException('Invitation is unavailable.');
      requirePermission(canAssign(role, invitation.role));
      await scope.revoke(invitation.id);
      if (!invitation.revokedAt && !invitation.consumedAt)
        await scope.audit(actorId).record({
          action: 'INVITATION_REVOKED',
          entityType: 'INVITATION',
          entityId: invitation.id,
        });
    });
  }

  async accept(userId: string, raw: string) {
    if (!this.tokens.isValid(raw)) throw invalid();
    const hash = this.tokens.hash(raw);
    const candidate = await this.repository.invitationWorkspace(hash);
    if (!candidate) throw invalid();
    try {
      return await this.repository.locked(candidate.workspaceId, async (scope) => {
        const invitation = await scope.invitationByHash(hash);
        const account = await scope.userEmail(userId);
        if (
          !invitation ||
          invitation.consumedAt ||
          invitation.revokedAt ||
          invitation.expiresAt <= new Date() ||
          invitation.email !== account.email ||
          !invitation.inviterId
        )
          throw invalid();
        const inviter = await scope.membership(invitation.inviterId);
        if (!inviter || !canAssign(inviter.role, invitation.role)) throw invalid();
        if (await scope.membership(userId))
          throw new ConflictException('You already belong to this workspace.');
        if ((await scope.consume(invitation.id)).count !== 1) throw invalid();
        await scope.addMember(userId, invitation.role);
        await scope.audit(userId).record({
          action: 'INVITATION_ACCEPTED',
          entityType: 'INVITATION',
          entityId: invitation.id,
          metadata: { toRole: invitation.role },
        });
        return { workspaceId: scope.id };
      });
    } catch (error: unknown) {
      if (error instanceof NotFoundException) throw invalid();
      throw error;
    }
  }
}
