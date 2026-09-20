import { expect, type Page } from '@playwright/test';
import { viewerComments } from './collaboration.journey';

export async function projectJourney(owner: Page, outsider: Page, workspaceId: string) {
  await owner.getByRole('button', { name: 'Projects', exact: true }).click();
  await owner.getByLabel('Project name', { exact: true }).fill('Release launch');
  await owner.getByLabel('Project description').fill('A real persisted release plan');
  await owner.getByRole('button', { name: 'Create project', exact: true }).click();
  await owner.getByRole('button', { name: 'Release launch', exact: true }).click();
  await expect(owner.getByRole('heading', { name: 'Release launch', exact: true })).toBeVisible();
  const projectId = new URL(owner.url()).searchParams.get('project');
  if (!projectId) throw new Error('Project URL missing');
  for (const title of ['Write release spec', 'Review launch']) {
    await owner.getByLabel('Task title', { exact: true }).fill(title);
    await owner.getByRole('button', { name: 'Create task', exact: true }).click();
    await expect(owner.getByRole('button', { name: title, exact: true })).toBeVisible();
  }
  await owner.getByRole('button', { name: 'Move Review launch up', exact: true }).click();
  await expect(
    owner.getByRole('region', { name: 'To do column', exact: true }).getByRole('listitem').first(),
  ).toContainText('Review launch');
  await owner.getByRole('button', { name: 'Write release spec', exact: true }).click();
  const taskId = new URL(owner.url()).searchParams.get('task');
  if (!taskId) throw new Error('Task URL missing');
  const dialog = owner.getByRole('dialog', { name: 'Task details', exact: true });
  await dialog.getByLabel('Description', { exact: true }).fill('Acceptance criteria agreed');
  await dialog.getByLabel('Assignee', { exact: true }).selectOption({ index: 1 });
  await dialog.getByRole('button', { name: 'Save task', exact: true }).click();
  await expect(dialog.getByLabel('Description', { exact: true })).toHaveValue(
    'Acceptance criteria agreed',
  );
  await dialog.getByLabel('Subtask title').fill('Check accessibility');
  await dialog.getByRole('button', { name: 'Add subtask' }).click();
  await dialog.getByRole('button', { name: 'Edit Check accessibility' }).click();
  const child = dialog.getByRole('listitem').filter({ hasText: 'Check accessibility' });
  await child.getByLabel('Status', { exact: true }).selectOption('DONE');
  await child.getByRole('button', { name: 'Save task', exact: true }).click();
  await expect(child.getByLabel('Status', { exact: true })).toHaveValue('DONE');
  await expect(dialog.getByRole('button', { name: 'Close task' })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Refresh activity', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Close task' }).focus();
  await owner.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Refresh activity', exact: true })).toBeFocused();
  await owner.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(
    owner.getByRole('button', { name: 'Write release spec', exact: true }),
  ).toBeFocused();
  await owner.getByLabel('Status for Write release spec').selectOption('IN_PROGRESS');
  await expect(
    owner.getByRole('region', { name: 'In progress column', exact: true }),
  ).toContainText('Write release spec');
  await owner.reload();
  await expect(
    owner.getByRole('region', { name: 'In progress column', exact: true }),
  ).toContainText('Workspace Owner');
  await expect(
    owner.getByRole('region', { name: 'To do column', exact: true }).getByRole('listitem').first(),
  ).toContainText('Review launch');
  await owner.getByRole('button', { name: 'Write release spec', exact: true }).click();
  await expect(dialog.getByLabel('Description', { exact: true })).toHaveValue(
    'Acceptance criteria agreed',
  );
  await expect(
    dialog.getByRole('listitem').filter({ hasText: 'Check accessibility' }),
  ).toContainText('Done');
  await dialog.getByRole('button', { name: 'Close task' }).click();
  await owner.setViewportSize({ width: 360, height: 640 });
  await expect(owner.getByRole('button', { name: 'Overview', exact: true })).toBeVisible();
  await expect(owner.getByRole('button', { name: 'Workspaces', exact: true })).toBeVisible();
  await expect(owner.getByRole('button', { name: 'Projects', exact: true })).toBeVisible();
  expect(
    await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await owner.setViewportSize({ width: 1280, height: 900 });
  const endpoint = `http://localhost:3000/workspaces/${workspaceId}/projects/${projectId}`;
  const outsiderUrl = outsider.url();
  expect((await outsider.request.get(endpoint)).status()).toBe(404);
  expect(
    (
      await outsider.request.patch(`${endpoint}/tasks/${taskId}`, {
        data: { title: 'Hostile edit', version: 1 },
      })
    ).status(),
  ).toBe(404);
  await outsider.goto(
    `/?view=projects&workspace=${workspaceId}&project=${projectId}&task=${taskId}`,
  );
  await expect(outsider.getByRole('alert')).toContainText('workspace is no longer available');
  await expect(outsider.getByText('Acceptance criteria agreed')).toHaveCount(0);
  await outsider.goto(outsiderUrl);
  await owner.getByRole('button', { name: 'Workspaces', exact: true }).click();
  expect(new URL(owner.url()).searchParams.has('project')).toBe(false);
  expect(new URL(owner.url()).searchParams.has('task')).toBe(false);
  return { projectId, taskId, endpoint };
}

export async function viewerJourney(
  viewer: Page,
  workspaceId: string,
  project: { projectId: string; taskId: string; endpoint: string },
) {
  await viewer.goto(`/?view=projects&workspace=${workspaceId}&project=${project.projectId}`);
  await expect(viewer.getByText('Read-only board', { exact: true })).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Create task', exact: true })).toHaveCount(0);
  await expect(viewer.getByRole('button', { name: 'Project settings', exact: true })).toHaveCount(
    0,
  );
  await expect(viewer.getByLabel('Status for Write release spec')).toHaveCount(0);
  await viewer.getByRole('button', { name: 'Write release spec', exact: true }).click();
  const dialog = viewer.getByRole('dialog', { name: 'Task details', exact: true });
  await expect(dialog.getByText('Acceptance criteria agreed')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save task', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Add subtask' })).toHaveCount(0);
  await viewerComments(viewer, project);
  expect(
    (
      await viewer.request.post(`${project.endpoint}/tasks`, { data: { title: 'Forbidden' } })
    ).status(),
  ).toBe(403);
  expect(
    (
      await viewer.request.post(`${project.endpoint}/tasks/${project.taskId}/move`, {
        data: { version: 1, status: 'DONE', beforeId: null },
      })
    ).status(),
  ).toBe(403);
  await dialog.getByRole('button', { name: 'Close task' }).click();
  await viewer.getByRole('button', { name: 'Workspaces', exact: true }).click();
}
