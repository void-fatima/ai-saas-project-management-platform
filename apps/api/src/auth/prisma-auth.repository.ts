import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { AuthRepository, NewSession, NewUser, RotatedSession } from './auth.repository.js';
import type { ActiveSessionRecord, UserRecord } from './auth.types.js';

const userSelect = {
  createdAt: true,
  email: true,
  emailVerifiedAt: true,
  id: true,
  name: true,
  passwordHash: true,
} as const;

@Injectable()
export class PrismaAuthRepository implements AuthRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createUserWithSession(
    input: NewUser,
    session: NewSession,
    now: Date,
  ): Promise<{ sessionId: string; user: UserRecord } | null> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const user = await transaction.user.create({ data: input, select: userSelect });
        const createdSession = await transaction.session.create({
          data: {
            expiresAt: session.expiresAt,
            lastSeenAt: now,
            rotatedAt: now,
            tokenHash: session.tokenHash,
            userId: user.id,
          },
          select: { id: true },
        });

        return { sessionId: createdSession.id, user };
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return null;
      }
      throw error;
    }
  }

  async createSession(userId: string, session: NewSession, now: Date): Promise<string> {
    return this.prisma.$transaction(async (transaction) => {
      const created = await transaction.session.create({
        data: {
          expiresAt: session.expiresAt,
          lastSeenAt: now,
          rotatedAt: now,
          tokenHash: session.tokenHash,
          userId,
        },
        select: { id: true },
      });

      const staleSessions = await transaction.session.findMany({
        orderBy: { createdAt: 'desc' },
        select: { id: true },
        skip: 10,
        where: { expiresAt: { gt: now }, revokedAt: null, userId },
      });

      if (staleSessions.length > 0) {
        await transaction.session.updateMany({
          data: { revokedAt: now },
          where: { id: { in: staleSessions.map(({ id }) => id) }, userId },
        });
      }

      return created.id;
    });
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    return this.prisma.user.findUnique({ where: { email }, select: userSelect });
  }

  async findActiveSession(tokenHash: string, now: Date): Promise<ActiveSessionRecord | null> {
    return this.prisma.session.findFirst({
      select: {
        expiresAt: true,
        id: true,
        rotatedAt: true,
        tokenHash: true,
        user: { select: userSelect },
      },
      where: {
        expiresAt: { gt: now },
        revokedAt: null,
        OR: [{ tokenHash }, { previousTokenHash: tokenHash, previousTokenExpiresAt: { gt: now } }],
      },
    });
  }

  async rotateSession(
    sessionId: string,
    currentTokenHash: string,
    nextSession: RotatedSession,
    now: Date,
  ): Promise<boolean> {
    const result = await this.prisma.session.updateMany({
      data: {
        expiresAt: nextSession.expiresAt,
        lastSeenAt: now,
        previousTokenExpiresAt: nextSession.previousTokenExpiresAt,
        previousTokenHash: currentTokenHash,
        rotatedAt: now,
        tokenHash: nextSession.tokenHash,
      },
      where: {
        expiresAt: { gt: now },
        id: sessionId,
        revokedAt: null,
        tokenHash: currentTokenHash,
      },
    });

    return result.count === 1;
  }

  async revokeSession(sessionId: string, userId: string, now: Date): Promise<void> {
    await this.prisma.session.updateMany({
      data: { revokedAt: now },
      where: { id: sessionId, revokedAt: null, userId },
    });
  }

  async revokeAllSessions(userId: string, now: Date): Promise<void> {
    await this.prisma.session.updateMany({
      data: { revokedAt: now },
      where: { revokedAt: null, userId },
    });
  }
}
