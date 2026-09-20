import { expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

declare global {
  interface Window {
    collaborationProbe?: {
      source: EventSource;
      ready: boolean;
      frames: string[];
      heartbeats: number;
    };
  }
}
type Project = { projectId: string; taskId: string; endpoint: string };

export async function foreignCollaborationJourney(owner: Page, outsider: Page, project: Project) {
  await outsider.evaluate(() => {
    const source = new EventSource('http://localhost:3000/realtime', { withCredentials: true });
    const probe = { source, ready: false, frames: [] as string[], heartbeats: 0 };
    window.collaborationProbe = probe;
    source.addEventListener('ready', () => {
      probe.ready = true;
    });
    source.addEventListener('workspace-changed', (event: MessageEvent<string>) =>
      probe.frames.push(event.data),
    );
    source.addEventListener('heartbeat', () => {
      probe.heartbeats++;
    });
  });
  try {
    await expect.poll(() => outsider.evaluate(() => window.collaborationProbe?.ready)).toBe(true);
    expect(
      (
        await owner.request.post(`${project.endpoint}/tasks/${project.taskId}/comments`, {
          data: { body: 'Private team comment', requestId: randomUUID() },
        })
      ).status(),
    ).toBe(201);
    // A transport heartbeat is a deterministic wire barrier, not a fixed sleep.
    await expect
      .poll(() => outsider.evaluate(() => window.collaborationProbe?.heartbeats ?? 0), {
        timeout: 20_000,
      })
      .toBeGreaterThan(0);
    expect(await outsider.evaluate(() => window.collaborationProbe?.frames)).toEqual([]);
    expect(
      (await outsider.request.get(`${project.endpoint}/tasks/${project.taskId}/comments`)).status(),
    ).toBe(404);
    const inbox: unknown = await (
      await outsider.request.get('http://localhost:3000/notifications')
    ).json();
    expect(inbox).toMatchObject({ items: [], unreadCount: 0 });
  } finally {
    await outsider.evaluate(() => {
      window.collaborationProbe?.source.close();
      delete window.collaborationProbe;
    });
  }
}

export async function collaborationJourney(
  owner: Page,
  member: Page,
  workspaceId: string,
  project: Project,
) {
  const ownerUrl = owner.url();
  const memberUrl = member.url();
  const route = `/?view=projects&workspace=${workspaceId}&project=${project.projectId}&task=${project.taskId}`;
  await owner.goto(route);
  const ownerTask = owner.getByRole('dialog', { name: 'Task details', exact: true });
  const assignee = ownerTask.getByLabel('Assignee');
  const memberId = await assignee
    .getByRole('option', { name: /^Invited Member/ })
    .getAttribute('value');
  if (!memberId) throw new Error('Invited member option missing');
  await assignee.selectOption(memberId);
  await ownerTask.getByRole('button', { name: 'Save task', exact: true }).click();
  await expect(ownerTask.getByLabel('Assignee')).toHaveValue(/.+/);
  await member.goto(route);
  const memberTask = member.getByRole('dialog', { name: 'Task details', exact: true });
  await expect(memberTask.getByText('Private team comment', { exact: true })).toBeVisible();
  await memberTask.getByLabel('New comment').fill('Draft survives realtime');
  await ownerTask.getByLabel('New comment').fill('Ready for your review');
  await ownerTask.getByRole('button', { name: 'Post comment' }).click();
  await expect(memberTask.getByText('Ready for your review', { exact: true })).toBeVisible();
  await expect(memberTask.getByLabel('New comment')).toHaveValue('Draft survives realtime');
  await expect(memberTask.getByLabel('New comment')).toBeFocused();
  await memberTask.getByRole('button', { name: 'Post comment' }).click();
  await expect(ownerTask.getByText('Draft survives realtime', { exact: true })).toBeVisible();
  await memberTask.getByRole('button', { name: 'Close task' }).click();
  const trigger = member.getByRole('button', { name: /Notifications, [1-9]\d* unread/ });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const panel = member.getByRole('dialog', { name: 'Notifications', exact: true });
  await expect(panel.getByText('New comment', { exact: false })).toBeVisible();
  await panel.getByRole('button', { name: 'Mark all read' }).click();
  await expect(panel.getByText('0 unread notifications', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Close notifications' }).click();
  await expect(member.getByRole('button', { name: 'Notifications, 0 unread' })).toBeFocused();
  await member.goto(route);
  await expect(memberTask.getByText('Ready for your review', { exact: true })).toBeVisible();
  await expect(memberTask.getByRole('region', { name: 'Task activity' })).toContainText(
    'commented on',
  );
  await owner.goto(ownerUrl);
  await member.goto(memberUrl);
}

export async function viewerComments(viewer: Page, project: Project) {
  const task = viewer.getByRole('dialog', { name: 'Task details', exact: true });
  await expect(task.getByText('Ready for your review', { exact: true })).toBeVisible();
  await expect(task.getByRole('button', { name: 'Post comment' })).toBeDisabled();
  await expect(task.getByRole('button', { name: 'Edit comment' })).toHaveCount(0);
  await expect(task.getByRole('region', { name: 'Task activity' })).toContainText('commented on');
  expect(
    (
      await viewer.request.post(`${project.endpoint}/tasks/${project.taskId}/comments`, {
        data: { body: 'Forbidden', requestId: randomUUID() },
      })
    ).status(),
  ).toBe(403);
}
