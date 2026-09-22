import { randomUUID } from 'node:crypto';
import { auditMetadata, auditQuery } from '../src/audit/audit.schemas.js';
import { auditWindow } from '../src/audit/audit.repository.js';
import { csvCell } from '../src/reporting/report.csv.js';
import { distribution, period, reportQuery } from '../src/reporting/reporting.schemas.js';

describe('Reporting and audit boundaries', () => {
  it('computes explicit completion rates and an honest zero denominator', () => {
    expect(distribution([]).completionPercent).toBe(0);
    expect(
      distribution([
        { status: 'TODO', count: 2 },
        { status: 'DONE', count: 1 },
      ]),
    ).toEqual({ TODO: 2, IN_PROGRESS: 0, DONE: 1, total: 3, completionPercent: 33.3 });
  });
  it('defines UTC calendar windows across a month/year boundary', () => {
    expect(period('7d', new Date('2026-01-02T23:59:59Z'))).toEqual({
      start: new Date('2025-12-27T00:00:00Z'),
      end: new Date('2026-01-03T00:00:00Z'),
      days: 7,
    });
    expect(period('90d').days).toBe(90);
  });
  it('escapes CSV quotes, commas, CRLF and spreadsheet formula prefixes', () => {
    expect(csvCell('hello,"world"\r\nnext')).toBe('"hello,""world""\r\nnext"');
    for (const text of [
      '=SUM(A1)',
      '+cmd',
      '-2+3',
      '@SUM(A1)',
      ' \t=1',
      '\r=1',
      '\ntext',
      '\uFEFF=1',
    ])
      expect(csvCell(text)).toBe(`"'${text}"`);
    expect(csvCell(42)).toBe('"42"');
    expect(csvCell(null)).toBe('""');
  });
  it('rejects unbounded, invalid and unknown report/audit queries', () => {
    for (const input of [
      { range: '1y' },
      { offset: -1 },
      { offset: 1000001 },
      { range: ['7d'] },
      { workspaceId: randomUUID() },
    ])
      expect(reportQuery.safeParse(input).success).toBe(false);
    for (const input of [
      { action: 'SECRET' },
      { entityType: 'USER' },
      { actorUserId: 'bad' },
      { limit: 101 },
      { limit: 0 },
      { from: '2026-02-30' },
      { cursor: 'x'.repeat(201) },
    ])
      expect(auditQuery.safeParse(input).success).toBe(false);
    expect(() => auditWindow(auditQuery.parse({ from: '2026-01-01', to: '2026-05-01' }))).toThrow(
      '90 days',
    );
    expect(() => auditWindow(auditQuery.parse({ from: '2026-02-02', to: '2026-02-01' }))).toThrow();
  });
  it('permits safe deltas but rejects arbitrary content, credentials and request bodies', () => {
    expect(
      auditMetadata.safeParse({ fromRole: 'Member', toRole: 'Viewer', fields: ['title'] }).success,
    ).toBe(true);
    for (const key of [
      'password',
      'cookie',
      'token',
      'apiKey',
      'body',
      'email',
      'prompt',
      'response',
      'title',
    ])
      expect(auditMetadata.safeParse({ [key]: 'sensitive' }).success).toBe(false);
  });
});
