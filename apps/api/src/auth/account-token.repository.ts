import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

export type AccountTokenKind = 'VERIFY_EMAIL' | 'RESET_PASSWORD';
export abstract class AccountTokenRepository {
  abstract issue(
    userId: string,
    kind: AccountTokenKind,
    hash: string,
    now: Date,
    expiresAt: Date,
  ): Promise<boolean>;
  abstract consume(
    hash: string,
    kind: AccountTokenKind,
    now: Date,
    passwordHash?: string,
  ): Promise<boolean>;
  abstract invalidate(hash: string): Promise<void>;
}

@Injectable()
export class PrismaAccountTokenRepository extends AccountTokenRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super();
  }

  issue(
    userId: string,
    kind: AccountTokenKind,
    tokenHash: string,
    now: Date,
    expiresAt: Date,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user || (kind === 'VERIFY_EMAIL' && user.emailVerifiedAt)) return false;
      const existing = await tx.accountToken.findUnique({
        where: { userId_kind: { userId, kind } },
      });
      if (existing && now.getTime() - existing.issuedAt.getTime() < 60_000) return false;
      const data = { tokenHash, issuedAt: now, expiresAt, consumedAt: null };
      await tx.accountToken.upsert({
        where: { userId_kind: { userId, kind } },
        create: { ...data, userId, kind },
        update: data,
      });
      return true;
    });
  }

  async consume(
    tokenHash: string,
    kind: AccountTokenKind,
    now: Date,
    passwordHash?: string,
  ): Promise<boolean> {
    if (kind === 'RESET_PASSWORD' && !passwordHash) throw new Error('Password hash is required.');
    const candidate = await this.prisma.accountToken.findUnique({
      where: { tokenHash },
      select: { userId: true },
    });
    if (!candidate) return false;
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${candidate.userId}::uuid FOR UPDATE`;
      const used = await tx.accountToken.updateMany({
        where: { tokenHash, kind, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (used.count !== 1) return false;
      await tx.user.update({
        where: { id: candidate.userId },
        data: kind === 'VERIFY_EMAIL' ? { emailVerifiedAt: now } : { passwordHash },
      });
      if (kind === 'RESET_PASSWORD') {
        await tx.session.updateMany({
          where: { userId: candidate.userId, revokedAt: null },
          data: { revokedAt: now },
        });
      }
      return true;
    });
  }

  async invalidate(tokenHash: string): Promise<void> {
    await this.prisma.accountToken.deleteMany({ where: { tokenHash } });
  }
}
