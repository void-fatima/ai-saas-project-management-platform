import { randomUUID } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client.js';
import { auditEvent, type AuditInput } from './audit.schemas.js';

// Only domain code constructs this writer inside an existing mutation transaction.
export class AuditWriter {
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly workspaceId: string,
    private readonly actorUserId: string | null,
  ) {}
  async record(input: AuditInput, dedupKey: string = randomUUID()) {
    const event = auditEvent.parse(input);
    await this.tx.auditEvent.createMany({
      data: [{ ...event, workspaceId: this.workspaceId, actorUserId: this.actorUserId, dedupKey }],
      skipDuplicates: true,
    });
  }
}
