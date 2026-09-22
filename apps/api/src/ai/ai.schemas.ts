import { z } from 'zod';
import { taskInput } from '../projects/project.schemas.js';

export const aiParams = z
  .object({
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    taskId: z.uuid().optional(),
    parentId: z.uuid().optional(),
  })
  .strict();
export type AiParams = z.infer<typeof aiParams>;
export const generateInput = z.object({ requestId: z.uuid() }).strict();
const line = z.string().trim().min(1).max(500);
const summary = z.string().trim().min(1).max(1200);
export const summaryOutput = z
  .object({ summary, highlights: z.array(line).max(6), limitations: z.array(line).max(4) })
  .strict();
export const planOutput = z
  .object({ summary, steps: z.array(line).min(1).max(8), questions: z.array(line).max(4) })
  .strict();
export const subtaskDraft = taskInput
  .pick({ title: true, description: true })
  .extend({ description: z.string().trim().max(2000) });
export const drafts = z
  .array(subtaskDraft)
  .min(1)
  .max(8)
  .refine(
    (items) => new Set(items.map((item) => item.title.toLowerCase())).size === items.length,
    'Subtask titles must be unique.',
  );
export const breakdownOutput = z.object({ summary, subtasks: drafts }).strict();
export const applyInput = z.object({ requestId: z.uuid(), subtasks: drafts }).strict();
export type ApplyInput = z.infer<typeof applyInput>;
export const outputSchemas = {
  SUMMARY: summaryOutput,
  BREAKDOWN: breakdownOutput,
  PLAN: planOutput,
};
