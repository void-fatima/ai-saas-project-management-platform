import { z } from 'zod';
export const reportParams = z
  .object({ workspaceId: z.uuid(), projectId: z.uuid().optional() })
  .strict();
export const reportQuery = z
  .object({
    range: z.enum(['7d', '30d', '90d']).default('30d'),
    offset: z.coerce.number().int().min(0).max(1000000).default(0),
  })
  .strict();
export type ReportQuery = z.infer<typeof reportQuery>;
export function period(range: ReportQuery['range'], now = new Date()) {
  const days = range === '7d' ? 7 : range === '90d' ? 90 : 30;
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return { start: new Date(end.getTime() - days * 86400000), end, days };
}
export function distribution(rows: { status: 'TODO' | 'IN_PROGRESS' | 'DONE'; count: number }[]) {
  const counts = { TODO: 0, IN_PROGRESS: 0, DONE: 0, total: 0, completionPercent: 0 };
  for (const row of rows) {
    counts[row.status] = row.count;
    counts.total += row.count;
  }
  counts.completionPercent = counts.total
    ? Math.round((counts.DONE / counts.total) * 1000) / 10
    : 0;
  return counts;
}
