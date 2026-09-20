import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { projectJourney, viewerJourney } from './projects.journey';

async function register(page: Page, name: string, email: string) {
  await page.goto('http://localhost:5173');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('workspace-browser-password-42');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('button', { name: 'Workspaces', exact: true }).click();
  await expect(page.getByText(/do not belong to a workspace/)).toBeVisible();
}
async function create(page: Page, name: string) {
  await page.getByLabel('New workspace name').fill(name);
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  const id = new URL(page.url()).searchParams.get('workspace');
  if (!id) throw new Error('Workspace selection missing');
  return id;
}
async function invitationLink(email: string) {
  const mailbox = fileURLToPath(new URL('../../../.tools/mail', import.meta.url));
  for (const entry of await readdir(mailbox)) {
    if (!entry.endsWith('.json')) continue;
    const path = join(mailbox, entry);
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (
      typeof value === 'object' &&
      value !== null &&
      'to' in value &&
      value.to === email &&
      'purpose' in value &&
      value.purpose === 'invite' &&
      'url' in value &&
      typeof value.url === 'string'
    ) {
      if (new URL(value.url).origin !== 'http://localhost:5173')
        throw new Error('Unexpected invitation origin');
      await unlink(path);
      return value.url;
    }
  }
  throw new Error('Test invitation was not delivered');
}

test('workspace creation, switching, invitations, role changes and cross-tenant denial', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const recipient = `invite-${randomUUID()}@example.com`;
  const second = await browser.newContext();
  try {
    const other = await second.newPage();
    await register(page, 'Workspace Owner', `owner-${randomUUID()}@example.com`);
    const teamId = await create(page, 'Design team');
    const secondId = await create(page, 'Research team');
    await page.getByLabel('Active workspace').selectOption(teamId);
    await expect(page.getByRole('heading', { name: 'Design team', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Active workspace')).toHaveValue(teamId);
    await register(other, 'Invited Member', recipient);
    const otherId = await create(other, 'Private workspace');
    const project = await projectJourney(page, other, teamId);
    // Browser-context requests share real session cookies; no request interception.
    expect((await other.request.get(`http://localhost:3000/workspaces/${teamId}`)).status()).toBe(
      404,
    );
    expect(
      (
        await page.request.patch(`http://localhost:3000/workspaces/${otherId}`, {
          data: { name: 'Forbidden' },
        })
      ).status(),
    ).toBe(404);
    await page.getByLabel('Invitation email').fill(`  ${recipient.toUpperCase()}  `);
    await page.getByLabel('Invitation role').selectOption('Member');
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByText(/Invitation sent/)).toBeVisible();
    const link = await invitationLink(recipient);
    await other.goto(link);
    await expect(other.getByRole('heading', { name: 'Join workspace' })).toBeVisible();
    await other.getByRole('button', { name: 'Accept invitation' }).click();
    await other.getByLabel('Active workspace').selectOption(teamId);
    await expect(other.getByRole('heading', { name: 'Design team', exact: true })).toBeVisible();
    await expect(other.getByRole('form', { name: 'Invite member' })).toHaveCount(0);
    await expect(other.getByRole('button', { name: 'Delete workspace' })).toHaveCount(0);
    expect(
      (
        await other.request.patch(`http://localhost:3000/workspaces/${teamId}`, {
          data: { name: 'Forbidden' },
        })
      ).status(),
    ).toBe(403);
    await page.getByRole('button', { name: 'Refresh workspaces' }).click();
    const memberRow = page.getByRole('listitem').filter({ hasText: recipient });
    await expect(memberRow).toContainText('Member');
    await page.getByLabel(`Role for ${recipient}`).selectOption('Viewer');
    await memberRow.getByRole('button', { name: 'Save role' }).click();
    await expect(memberRow).toContainText('Viewer');
    await viewerJourney(other, teamId, project);
    await page.getByLabel(`Role for ${recipient}`).selectOption('Admin');
    await memberRow.getByRole('button', { name: 'Save role' }).click();
    await expect(memberRow).toContainText('Admin');
    await other.getByRole('button', { name: 'Refresh workspaces' }).click();
    await expect(other.getByRole('form', { name: 'Invite member' })).toBeVisible();
    await expect(
      other.getByLabel('Invitation role').getByRole('option', { name: 'Admin', exact: true }),
    ).toHaveCount(0);
    await memberRow.getByRole('button', { name: 'Remove member' }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(memberRow).toHaveCount(0);
    expect((await other.request.get(`http://localhost:3000/workspaces/${teamId}`)).status()).toBe(
      404,
    );
    await other.getByRole('button', { name: 'Refresh workspaces' }).click();
    await expect(other.getByRole('heading', { name: 'Design team', exact: true })).toHaveCount(0);
    await expect(other.getByRole('alert')).toContainText('no longer available');
    await page.getByLabel('Active workspace').selectOption(secondId);
    await page.setViewportSize({ width: 360, height: 640 });
    await expect(page.getByLabel('New workspace name')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete workspace' })).toBeVisible();
  } finally {
    await second.close();
  }
});
