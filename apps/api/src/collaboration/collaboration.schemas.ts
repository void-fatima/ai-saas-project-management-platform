import { z } from 'zod';
import { pageInput } from '../projects/project.schemas.js';

export const commentParams = z
  .object({
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    taskId: z.uuid(),
    parentId: z.uuid().optional(),
    commentId: z.uuid().optional(),
  })
  .strict();
export type CommentParams = z.infer<typeof commentParams>;
const body = z
  .string()
  .trim()
  .min(1)
  .max(4000)
  .refine((value) => !value.includes('\0'));
export const commentInput = z.object({ body, requestId: z.uuid() }).strict();
export const commentVersion = z.object({ version: z.number().int().positive() }).strict();
export const commentUpdate = commentVersion.extend({ body });
export const activityQuery = pageInput
  .extend({ projectId: z.uuid().optional(), taskId: z.uuid().optional() })
  .refine((value) => !value.taskId || !!value.projectId);
