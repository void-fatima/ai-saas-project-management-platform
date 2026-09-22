import type { Report } from './reporting.repository.js';

export function csvCell(value: string | number | null) {
  const text = String(value ?? '');
  // Quoting alone does not prevent spreadsheet formulas, including whitespace-prefixed formulas.
  const candidate = text.replace(/^[\s\p{Cc}]+/u, '');
  const safe = /^[=+\-@]/u.test(candidate) || /^[\t\r\n]/u.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function reportCsv(report: Report) {
  const rows: (string | number | null)[][] = [
    ['section', 'id_or_date', 'label', 'value', 'detail'],
  ];
  rows.push([
    'scope',
    report.workspaceId,
    report.project?.name ?? 'Workspace report',
    report.range,
    'Current totals include archived projects; daily trend uses UTC activity events.',
  ]);
  rows.push([
    'page',
    null,
    'Offset',
    report.page.offset,
    report.page.nextOffset === null ? 'Last page' : `Next offset: ${report.page.nextOffset}`,
  ]);
  rows.push(
    ['projects', null, 'Active', report.projects.active, null],
    ['projects', null, 'Archived', report.projects.archived, null],
  );
  if (report.project)
    rows.push([
      'project_metadata',
      report.project.id,
      report.project.name,
      report.project.description,
      report.project.archived ? 'Archived' : 'Active',
    ]);
  for (const kind of ['tasks', 'subtasks'] as const) {
    for (const status of ['TODO', 'IN_PROGRESS', 'DONE', 'total', 'completionPercent'] as const)
      rows.push([kind, null, status, report[kind][status], null]);
  }
  for (const project of report.projects.items)
    rows.push([
      'project',
      project.id,
      project.name,
      project.archived ? 'Archived' : 'Active',
      null,
    ]);
  for (const member of report.workload)
    for (const metric of ['tasks', 'subtasks', 'open', 'done'] as const)
      rows.push(['workload', member.userId, member.name, member[metric], metric]);
  for (const point of report.trend)
    for (const metric of ['created', 'completed', 'activity'] as const)
      rows.push(['trend', point.day, metric, point[metric], null]);
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
