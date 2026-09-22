import { expect, type Page } from '@playwright/test';

export async function aiJourney(owner: Page) {
  const dialog = owner.getByRole('dialog', { name: 'Task details', exact: true });
  await dialog.getByRole('button', { name: 'Suggest subtasks' }).click();
  await expect(
    dialog.getByRole('heading', { name: 'AI suggestion — review required' }),
  ).toBeVisible();
  await dialog
    .getByLabel('Suggested title 1', { exact: true })
    .fill('Reviewed AI acceptance checks');
  await expect(dialog.getByRole('heading', { name: 'Reviewed AI acceptance checks' })).toHaveCount(
    0,
  );
  await dialog.getByRole('button', { name: 'Confirm and create subtasks' }).click();
  await expect(
    dialog.getByRole('heading', { name: 'Reviewed AI acceptance checks', exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('heading', { name: 'Validate the completed work', exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Reload task' }).click();
  await expect(
    dialog.getByRole('heading', { name: 'Reviewed AI acceptance checks', exact: true }),
  ).toBeVisible();
}
