import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { cursorSchema, type AuditQuery } from './audit.schemas.js';

export function auditWindow(query: AuditQuery, now = new Date()) {
  const to = query.to ?? now.toISOString().slice(0, 10);
  const end = new Date(`${to}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const start = query.from
    ? new Date(`${query.from}T00:00:00Z`)
    : new Date(end.getTime() - 30 * 86400000);
  if (end <= start || end.getTime() - start.getTime() > 90 * 86400000)
    throw new BadRequestException('Choose a date range of at most 90 days.');
  return { start, end };
}
export class AuditScope {
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly workspaceId: string,
  ) {}
  async read(query: AuditQuery) {
    const window = auditWindow(query);
    let cursor: { at: string; id: string } | undefined;
    if (query.cursor) {
      try {
        cursor = cursorSchema.parse(
          JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')) as unknown,
        );
      } catch {
        throw new BadRequestException('Invalid audit cursor.');
      }
    }
    const rows = await this.tx.auditEvent.findMany({
      where: {
        workspaceId: this.workspaceId,
        action: query.action,
        entityType: query.entityType,
        actorUserId: query.actorUserId,
        createdAt: { gte: window.start, lt: window.end },
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.at) } },
                { createdAt: new Date(cursor.at), id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      select: {
        id: true,
        workspaceId: true,
        actorUserId: true,
        action: true,
        entityType: true,
        entityId: true,
        metadata: true,
        createdAt: true,
      },
    });
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > query.limit && last
          ? Buffer.from(JSON.stringify({ at: last.createdAt.toISOString(), id: last.id })).toString(
              'base64url',
            )
          : null,
    };
  }
}
