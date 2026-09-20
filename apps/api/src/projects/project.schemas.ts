import { z } from 'zod';

export const status = z.enum(['TODO', 'IN_PROGRESS', 'DONE']);
export const pageInput = z
  .object({ offset: z.coerce.number().int().min(0).max(1_000_000).default(0) })
  .strict();
export const taskListInput = pageInput.extend({ status: status.optional() });
export const projectInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(5000).default(''),
  })
  .strict();
export const projectUpdate = projectInput
  .partial()
  .extend({ archived: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0);
export const taskInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(10000).default(''),
    assigneeId: z.uuid().nullable().optional(),
  })
  .strict();
export const taskUpdate = taskInput
  .partial()
  .extend({ version: z.number().int().positive(), status: status.optional() })
  .refine((value) => Object.keys(value).length > 1);
export const moveInput = z
  .object({ version: z.number().int().positive(), status, beforeId: z.uuid().nullable() })
  .strict();
export type ProjectInput = z.infer<typeof projectInput>;
export type ProjectUpdate = z.infer<typeof projectUpdate>;
export type TaskInput = z.infer<typeof taskInput>;
export type TaskUpdate = z.infer<typeof taskUpdate>;
export type MoveInput = z.infer<typeof moveInput>;
