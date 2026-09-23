import { fireEvent, render, screen } from '@testing-library/react';
import { WorkspacePanel } from './WorkspacePanel';
import type { Role } from './workspace-api';

function setup(role: Role) {
  const manageable =
    role === 'Owner'
      ? ['Admin', 'Manager', 'Member', 'Viewer']
      : role === 'Admin'
        ? ['Manager', 'Member', 'Viewer']
        : [];
  const detail = {
    workspace: { id: 'workspace-a', name: 'Design' },
    role,
    members: [{ userId: 'self', role, user: { name: 'Taylor', email: 'taylor@example.com' } }],
    invitations: [],
    permissions: {
      rename: manageable.length > 0,
      delete: role === 'Owner',
      leave: role !== 'Owner',
      assignableRoles: manageable,
    },
  };
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ workspaces: [{ workspace: detail.workspace, role }] })),
    )
    .mockResolvedValue(new Response(JSON.stringify(detail)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
describe('Workspace interface permissions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, '', '/');
  });
  it.each(['Owner', 'Admin', 'Manager', 'Member', 'Viewer'] as const)(
    'shows only supported controls for %s',
    async (role) => {
      setup(role);
      render(<WorkspacePanel userId="self" />);
      await screen.findByRole('heading', { name: 'Design' });
      expect(Boolean(screen.queryByRole('button', { name: 'Delete workspace' }))).toBe(
        role === 'Owner',
      );
      expect(Boolean(screen.queryByRole('button', { name: 'Leave workspace' }))).toBe(
        role !== 'Owner',
      );
      expect(Boolean(screen.queryByRole('form', { name: 'Invite member' }))).toBe(
        role === 'Owner' || role === 'Admin',
      );
      expect(screen.queryByRole('button', { name: 'Save role' })).not.toBeInTheDocument();
      if (role === 'Admin')
        expect(screen.queryByRole('option', { name: 'Admin' })).not.toBeInTheDocument();
    },
  );
  it('offers no-workspace onboarding', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"workspaces":[]}')));
    render(<WorkspacePanel userId="self" />);
    await screen.findByText(/do not belong to a workspace/);
    expect(screen.getByRole('button', { name: 'Create workspace' })).toBeEnabled();
  });
  it('confirms deletion with cancel initially focused', async () => {
    setup('Owner');
    render(<WorkspacePanel userId="self" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete workspace' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Permanently delete Design, its projects, tasks, comments, memberships and invitations?',
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
