import { z } from 'zod';

export const auditActions = z.enum([
  'WORKSPACE_CREATED',
  'WORKSPACE_UPDATED',
  'WORKSPACE_DELETED',
  'INVITATION_ISSUED',
  'INVITATION_REVOKED',
  'INVITATION_DELIVERY_FAILED',
  'INVITATION_ACCEPTED',
  'MEMBER_ROLE_CHANGED',
  'MEMBER_REMOVED',
  'MEMBER_LEFT',
  'PROJECT_CREATED',
  'PROJECT_UPDATED',
  'PROJECT_ARCHIVED',
  'PROJECT_RESTORED',
  'PROJECT_DELETED',
  'TASK_CREATED',
  'TASK_UPDATED',
  'TASK_STATUS_CHANGED',
  'TASK_ASSIGNED',
  'TASK_REORDERED',
  'TASK_DELETED',
  'AI_BREAKDOWN_APPLIED',
  'COMMENT_CREATED',
  'COMMENT_UPDATED',
  'COMMENT_DELETED',
]);
export const entityTypes = z.enum([
  'WORKSPACE',
  'INVITATION',
  'MEMBERSHIP',
  'PROJECT',
  'TASK',
  'SUBTASK',
  'COMMENT',
]);
const role = z.enum(['Owner', 'Admin', 'Manager', 'Member', 'Viewer']);
const status = z.enum(['TODO', 'IN_PROGRESS', 'DONE']);
export const auditMetadata = z
  .object({
    fromRole: role.optional(),
    toRole: role.optional(),
    fromStatus: status.optional(),
    toStatus: status.optional(),
    projectId: z.uuid().optional(),
    parentId: z.uuid().nullable().optional(),
    assigneeId: z.uuid().nullable().optional(),
    previousAssigneeId: z.uuid().nullable().optional(),
    version: z.number().int().positive().optional(),
    count: z.number().int().min(1).max(8).optional(),
    fields: z
      .array(
        z.enum(['name', 'title', 'description', 'status', 'assigneeId', 'archived', 'position']),
      )
      .max(7)
      .optional(),
  })
  .strict();
export const auditEvent = z
  .object({
    action: auditActions,
    entityType: entityTypes,
    entityId: z.uuid(),
    metadata: auditMetadata.default({}),
  })
  .strict();
export type AuditInput = z.input<typeof auditEvent>;
export const cursorSchema = z.object({ at: z.iso.datetime(), id: z.uuid() }).strict();
export const auditQuery = z
  .object({
    action: auditActions.optional(),
    entityType: entityTypes.optional(),
    actorUserId: z.uuid().optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .max(200)
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type AuditQuery = z.infer<typeof auditQuery>;
