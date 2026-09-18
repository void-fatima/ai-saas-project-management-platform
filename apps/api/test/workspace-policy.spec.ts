import { can, canAssign } from '../src/workspaces/workspace.policy.js';

describe('Workspace role policy', () => {
  it.each(['Owner', 'Admin', 'Manager', 'Member', 'Viewer'] as const)(
    'never grants Owner through %s',
    (role) => {
      expect(canAssign(role, 'Owner')).toBe(false);
      expect(can(role, 'delete')).toBe(role === 'Owner');
      expect(can(role, 'leave')).toBe(role !== 'Owner');
      expect(can(role, 'view')).toBe(true);
    },
  );
  it('limits Admin delegation and reserves Admin grants for Owner', () => {
    expect(canAssign('Owner', 'Admin')).toBe(true);
    expect(canAssign('Admin', 'Admin')).toBe(false);
    for (const role of ['Manager', 'Member', 'Viewer'] as const) {
      expect(canAssign('Admin', role)).toBe(true);
      expect(can(role, 'manage')).toBe(false);
    }
  });
});
