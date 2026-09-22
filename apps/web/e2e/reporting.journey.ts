import { expect, type Page } from '@playwright/test';

export async function reportingJourney(owner: Page) {
  // The owner just created subtasks via explicit AI approval in the existing task workflow.
  const dialog = owner.getByRole('dialog', { name: 'Task details', exact: true });
  await dialog.getByRole('button', { name: 'Close task' }).click();
  await owner.getByRole('button', { name: 'Analytics and reports', exact: true }).click();
  const panel = owner.getByRole('region', { name: 'Analytics and reports', exact: true });
  await expect(panel.getByRole('table', { name: 'Status distribution' })).toContainText('Subtasks');
  await expect(panel.getByRole('row', { name: 'Subtasks 2 0 1 3 33.3%' })).toBeVisible();
  await panel.getByRole('button', { name: 'Reports', exact: true }).click();
  const download = owner.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download this report page as CSV' }).click();
  expect((await download).suggestedFilename()).toBe('workspace-report.csv');
  await panel.getByRole('button', { name: 'Release launch · Active', exact: true }).click();
  await expect(
    panel.getByRole('heading', { name: 'Project report: Release launch' }),
  ).toBeVisible();
  await panel.getByRole('button', { name: 'Audit log', exact: true }).click();
  await panel.getByLabel('Audit action').selectOption('AI_BREAKDOWN_APPLIED');
  await panel.getByRole('button', { name: 'Apply audit filters' }).click();
  await expect(
    panel.locator('strong').getByText('ai breakdown applied', { exact: true }),
  ).toBeVisible();
  await expect(panel.getByText('count: 2', { exact: true })).toBeVisible();
}
