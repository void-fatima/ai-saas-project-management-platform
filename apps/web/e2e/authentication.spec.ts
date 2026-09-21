import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readdir, readFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const password = 'browser-test-password-42';
const mailbox = fileURLToPath(new URL('../../../.tools/mail', import.meta.url));

async function register(page: Page, email: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Browser Tester');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page
    .getByRole('form', { name: 'Register', exact: true })
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(page.getByRole('navigation')).toBeVisible();
}

async function login(page: Page, email: string, secret = password) {
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(secret);
  await page
    .getByRole('form', { name: 'Login', exact: true })
    .getByRole('button', { name: 'Sign in', exact: true })
    .click();
  await expect(page.getByRole('navigation')).toBeVisible();
}

async function deliveredLink(email: string, purpose: string) {
  let link: string | undefined;
  await expect
    .poll(async () => {
      const entries = await readdir(mailbox);
      for (const entry of entries) {
        if (!entry.endsWith('.json')) continue;
        const path = join(mailbox, entry);
        const value: unknown = JSON.parse(await readFile(path, 'utf8'));
        if (
          typeof value !== 'object' ||
          value === null ||
          !('to' in value) ||
          value.to !== email ||
          !('purpose' in value) ||
          value.purpose !== purpose ||
          !('url' in value) ||
          typeof value.url !== 'string'
        )
          continue;
        const url = new URL(value.url);
        if (url.origin !== 'http://localhost:5173') throw new Error('Unexpected test mail origin');
        link = value.url;
        await unlink(path); // Only the unique test account's own delivered message.
        return true;
      }
      return false;
    })
    .toBe(true);
  if (!link) throw new Error('Test mail was not delivered');
  return link;
}

test('real cookies restore identity, dialogs contain focus, and logout removes protected UI', async ({
  page,
  context,
}) => {
  const email = `browser-${randomUUID()}@example.com`;
  await register(page, email);
  const cookies = await context.cookies('http://localhost:3000');
  expect(cookies.some((cookie) => cookie.httpOnly && cookie.sameSite === 'Strict')).toBe(true);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await login(page, email);
  const restored = page.waitForResponse(
    (response) => response.url().endsWith('/auth/me') && response.status() === 200,
  );
  await page.reload();
  await restored;
  await expect(page.getByLabel('Signed-in account')).toHaveText('Browser Tester');
  const trigger = page.getByRole('button', { name: 'Open workspace search' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  await expect(dialog.getByRole('combobox')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Close command palette' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('combobox')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(dialog).not.toBeVisible();
  const core = page.getByRole('button', { name: 'Interactive workspace overview' });
  for (let i = 0; i < 5; i += 1) await core.click();
  const developer = page.getByRole('dialog', { name: 'Developer system panel' });
  await expect(developer.getByRole('button')).toBeFocused();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(core).toBeFocused();
  await page.setViewportSize({ width: 360, height: 480 });
  await expect(page.getByRole('button', { name: 'Overview', exact: true })).toBeVisible();
  await trigger.click();
  const fits = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight;
  });
  expect(fits).toBe(true);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('form', { name: 'Login', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
});

test('development mail verifies email and resets password while revoking another device', async ({
  page,
  browser,
}) => {
  const email = `recovery-browser-${randomUUID()}@example.com`;
  await register(page, email);
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await page.getByRole('button', { name: 'Send verification email', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('If the account is eligible');
  await page.goto(await deliveredLink(email, 'verify'));
  await page.getByRole('button', { name: 'Verify your email', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Your email is verified');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Email verified', { exact: true })).toBeVisible();
  const second = await browser.newContext();
  try {
    const other = await second.newPage();
    await other.goto('http://localhost:5173');
    await login(other, email);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Forgot password', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('If the account is eligible');
    await page.goto(await deliveredLink(email, 'reset'));
    await page.getByLabel('New password').fill('replacement-browser-password-42');
    await page.getByRole('button', { name: 'Reset password', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('All devices are signed out');
    await other.reload();
    await expect(other.getByRole('form', { name: 'Login', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await login(page, email, 'replacement-browser-password-42');
  } finally {
    await second.close();
  }
});
