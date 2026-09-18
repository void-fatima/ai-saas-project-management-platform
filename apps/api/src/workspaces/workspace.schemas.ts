import { z } from 'zod';
import { emailSchema } from '../auth/auth.schemas.js';
import { assignableRoles } from './workspace.policy.js';

export const workspaceInput = z.object({ name: z.string().trim().min(2).max(100) }).strict();
export const roleInput = z.object({ role: z.enum(assignableRoles) }).strict();
export const invitationInput = roleInput.extend({ email: emailSchema });
export type WorkspaceInput = z.infer<typeof workspaceInput>;
export type RoleInput = z.infer<typeof roleInput>;
export type InvitationInput = z.infer<typeof invitationInput>;
