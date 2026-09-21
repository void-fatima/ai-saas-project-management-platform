import { expect, type Page } from '@playwright/test';

async function search(page: Page, query: string) {
  await page.getByRole('button', { name: 'Open workspace search', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  await dialog.getByRole('combobox', { name: 'Search workspace', exact: true }).fill(query);
  return dialog;
}

export async function discoveryJourney(
  owner: Page,
  outsider: Page,
  workspaceId: string,
  emptyId: string,
  foreignId: string,
  project: { projectId: string; taskId: string; endpoint: string },
) {
  await owner.getByRole('button', { name: 'Overview', exact: true }).click();
  const dashboard = owner.getByRole('region', { name: 'Workspace dashboard', exact: true });
  await expect(dashboard.getByLabel('Dashboard workspace')).toHaveValue(workspaceId);
  await expect(dashboard.getByText('1 active · 0 archived', { exact: true })).toBeVisible();
  await expect(dashboard.getByText('0 of 2 completed', { exact: true })).toBeVisible();
  await expect(dashboard.getByText('1 of 1 completed', { exact: true })).toBeVisible();
  await expect(dashboard.getByRole('row', { name: 'In progress 1 0' })).toBeVisible();
  // Real SSE invalidation repairs persisted counts; no interception or manual refresh.
  const created = await owner.request.post(`${project.endpoint}/tasks`, {
    data: { title: 'Dashboard live probe' },
  });
  expect(created.status()).toBe(201);
  const value: unknown = await created.json();
  if (
    typeof value !== 'object' ||
    value === null ||
    !('id' in value) ||
    typeof value.id !== 'string'
  )
    throw new Error('Task response missing');
  await expect(dashboard.getByText('0 of 3 completed', { exact: true })).toBeVisible();
  expect((await owner.request.delete(`${project.endpoint}/tasks/${value.id}`)).status()).toBe(204);
  await expect(dashboard.getByText('0 of 2 completed', { exact: true })).toBeVisible();

  let dialog = await search(owner, 'Release launch');
  await dialog.getByRole('option', { name: 'Project: Release launch', exact: true }).click();
  await expect(owner.getByRole('heading', { name: 'Release launch', exact: true })).toBeVisible();
  expect(new URL(owner.url()).searchParams.get('project')).toBe(project.projectId);
  dialog = await search(owner, 'Write release spec');
  await expect(
    dialog.getByRole('option', { name: 'Task: Write release spec', exact: true }),
  ).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Search workspace', exact: true }).press('Enter');
  const task = owner.getByRole('dialog', { name: 'Task details', exact: true });
  await expect(task.getByLabel('Description', { exact: true })).toHaveValue(
    'Acceptance criteria agreed',
  );
  expect(new URL(owner.url()).searchParams.get('task')).toBe(project.taskId);
  await task.getByRole('button', { name: 'Close task' }).click();
  dialog = await search(owner, 'Check accessibility');
  await dialog.getByRole('option', { name: 'Subtask: Check accessibility', exact: true }).click();
  await expect(task.getByText('Selected subtask', { exact: true })).toBeVisible();
  await expect(
    task.getByRole('heading', { name: 'Check accessibility', exact: true }),
  ).toBeVisible();
  expect(new URL(owner.url()).searchParams.has('subtask')).toBe(true);
  await task.getByRole('button', { name: 'Close task' }).click();

  await owner.getByRole('button', { name: 'Overview', exact: true }).click();
  await dashboard.getByLabel('Dashboard workspace').selectOption(emptyId);
  await expect(dashboard.getByText(/No projects yet/)).toBeVisible();
  await expect(dashboard.getByText('Write release spec', { exact: true })).toHaveCount(0);
  await owner.reload();
  await expect(dashboard.getByLabel('Dashboard workspace')).toHaveValue(emptyId);
  dialog = await search(owner, 'Write release spec');
  await expect(dialog.getByText('No results in this workspace.', { exact: true })).toBeVisible();
  await dialog
    .getByRole('combobox', { name: 'Search workspace scope', exact: true })
    .selectOption(workspaceId);
  await expect(
    dialog.getByRole('option', { name: 'Task: Write release spec', exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole('combobox', { name: 'Search workspace scope', exact: true })
    .selectOption(emptyId);
  await expect(
    dialog.getByRole('option', { name: 'Task: Write release spec', exact: true }),
  ).toHaveCount(0);
  await expect(dialog.getByText('No results in this workspace.', { exact: true })).toBeVisible();
  await owner.keyboard.press('Escape');
  await owner.setViewportSize({ width: 360, height: 640 });
  await expect(dashboard.getByLabel('Dashboard workspace')).toBeVisible();
  expect(
    await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await owner.setViewportSize({ width: 1280, height: 900 });

  await outsider.getByRole('button', { name: 'Overview', exact: true }).click();
  const response = await outsider.request.get(
    `http://localhost:3000/workspaces/${foreignId}/search?q=Write%20release%20spec`,
  );
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ items: [], nextOffset: null });
  dialog = await search(outsider, 'Write release spec');
  await expect(dialog.getByText('No results in this workspace.', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('option', { name: /Write release spec/ })).toHaveCount(0);
  await outsider.keyboard.press('Escape');
  await owner.getByRole('button', { name: 'Workspaces', exact: true }).click();
  await owner.getByLabel('Active workspace').selectOption(workspaceId);
  await expect(owner.getByRole('heading', { name: 'Design team', exact: true })).toBeVisible();
  await outsider.getByRole('button', { name: 'Workspaces', exact: true }).click();
}
