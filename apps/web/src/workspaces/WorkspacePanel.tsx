import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Form } from '../components/ui/Form';
import { FormField } from '../components/ui/FormField';
import { useModalDialog } from '../components/use-modal-dialog';
import {
  parseRole,
  parseWorkspace,
  WorkspaceError,
  workspaceRequest,
  type Membership,
  type Role,
} from './workspace-api';
import { useWorkspaces } from './use-workspaces';
import './workspace.css';

export function WorkspacePanel({ userId }: { userId: string }) {
  const { choices, detail, loading, error, load } = useWorkspaces();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('Member');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  const [confirm, setConfirm] = useState<{ title: string; path: string; method: string } | null>(
    null,
  );
  const controller = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    setInviteRole('Member');
    setEmail('');
  }, [detail?.workspace.id, detail?.role]);
  useEffect(() => {
    heading.current?.focus();
    return () => {
      controller.current?.abort();
      controller.current = null;
    };
  }, []);

  async function mutate(path: string, method: string, body?: unknown, created = false) {
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request;
    const timer = window.setTimeout(() => request.abort(), 15_000);
    setPending(true);
    setFailure('');
    setMessage('');
    try {
      const result = await workspaceRequest(path, method, body, request.signal);
      if (controller.current !== request) return;
      setConfirm(null);
      if (created) setName('');
      if (path.endsWith('/invitations')) setEmail('');
      await load(created ? parseWorkspace(result).id : undefined);
      if (controller.current === request)
        setMessage(
          path.endsWith('/invitations')
            ? 'Invitation sent. Reissuing replaces the old link after a one-minute cooldown.'
            : 'Workspace updated.',
        );
    } catch (cause: unknown) {
      if (controller.current !== request) return;
      setConfirm(null);
      setFailure(
        cause instanceof WorkspaceError
          ? cause.message
          : 'Unable to complete the action. Please retry.',
      );
      if (cause instanceof WorkspaceError && (cause.status === 403 || cause.status === 404))
        await load();
    } finally {
      window.clearTimeout(timer);
      if (controller.current === request) {
        controller.current = null;
        setPending(false);
      }
    }
  }

  const busy = loading || pending;
  return (
    <section className="workspace-panel" aria-labelledby="workspaces-title">
      <header className="project-toolbar">
        <div>
          <h2 id="workspaces-title" ref={heading} tabIndex={-1}>
            Workspaces
          </h2>
          <p>Create a shared space, invite people, and manage workspace access.</p>
        </div>
        <Button disabled={busy} variant="ghost" onClick={() => void load()}>
          Refresh workspaces
        </Button>
      </header>
      {loading ? <p role="status">Loading workspaces…</p> : null}
      {error || failure ? <p role="alert">{failure || error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      <div className="workspace-sections">
        <section className="page-section workspace-create" aria-labelledby="create-workspace-title">
          <h3 id="create-workspace-title">Create workspace</h3>
          {!loading && choices.length === 0 && !error ? (
            <p>You do not belong to a workspace yet. Create one to get started.</p>
          ) : null}
          <Form
            aria-label="Create workspace"
            onSubmit={() => void mutate('', 'POST', { name: name.trim() }, true)}
          >
            <FormField
              label="New workspace name"
              value={name}
              required
              minLength={2}
              maxLength={100}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
            <Button disabled={busy} type="submit">
              Create workspace
            </Button>
          </Form>
        </section>
        {choices.length || detail ? (
          <section className="page-section workspace-active" aria-label="Workspace details">
            {choices.length ? (
              <label className="workspace-select">
                Active workspace
                <select
                  aria-label="Active workspace"
                  disabled={busy}
                  value={detail?.workspace.id ?? ''}
                  onChange={(event) => {
                    setMessage('');
                    setFailure('');
                    void load(event.target.value);
                  }}
                >
                  {!detail ? (
                    <option value="" disabled hidden>
                      Select workspace
                    </option>
                  ) : null}
                  {choices.map((choice) => (
                    <option key={choice.workspace.id} value={choice.workspace.id}>
                      {choice.workspace.name} ({choice.role})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {detail ? (
              <div className="workspace-detail" key={detail.workspace.id}>
                <div className="workspace-identity">
                  <h3>{detail.workspace.name}</h3>
                  <p className="workspace-role">
                    Your role: <strong>{detail.role}</strong>
                  </p>
                </div>
                {detail.permissions.rename ? (
                  <RenameForm
                    name={detail.workspace.name}
                    busy={busy}
                    onSave={(next) =>
                      void mutate(`/${detail.workspace.id}`, 'PATCH', { name: next })
                    }
                  />
                ) : null}
                <h3>Members</h3>
                <ul className="workspace-members">
                  {detail.members.map((member) => (
                    <MemberRow
                      key={`${member.userId}:${member.role}`}
                      member={member}
                      roles={
                        member.userId !== userId &&
                        member.role !== 'Owner' &&
                        detail.permissions.assignableRoles.includes(member.role)
                          ? detail.permissions.assignableRoles
                          : []
                      }
                      busy={busy}
                      onRole={(role) =>
                        void mutate(`/${detail.workspace.id}/members/${member.userId}`, 'PATCH', {
                          role,
                        })
                      }
                      onRemove={() =>
                        setConfirm({
                          title: `Remove ${member.user.name} from this workspace?`,
                          path: `/${detail.workspace.id}/members/${member.userId}`,
                          method: 'DELETE',
                        })
                      }
                    />
                  ))}
                </ul>
                {detail.permissions.assignableRoles.length ? (
                  <>
                    <h3>Invite a member</h3>
                    <Form
                      aria-label="Invite member"
                      onSubmit={() =>
                        void mutate(`/${detail.workspace.id}/invitations`, 'POST', {
                          email: email.trim(),
                          role: inviteRole,
                        })
                      }
                    >
                      <FormField
                        label="Invitation email"
                        type="email"
                        value={email}
                        required
                        maxLength={254}
                        disabled={busy}
                        onChange={(event) => setEmail(event.target.value)}
                      />
                      <label>
                        Invitation role
                        <select
                          aria-label="Invitation role"
                          value={inviteRole}
                          disabled={busy}
                          onChange={(event) => setInviteRole(parseRole(event.target.value))}
                        >
                          {detail.permissions.assignableRoles.map((role) => (
                            <option key={role}>{role}</option>
                          ))}
                        </select>
                      </label>
                      <Button type="submit" disabled={busy}>
                        Send invitation
                      </Button>
                    </Form>
                    <h3>Pending invitations</h3>
                    {!detail.invitations.length ? (
                      <p>No pending invitations you can manage.</p>
                    ) : (
                      <ul className="workspace-members">
                        {detail.invitations.map((invitation) => (
                          <li key={invitation.id}>
                            <span>
                              {invitation.email} — {invitation.role}
                              <small>
                                Expires {new Date(invitation.expiresAt).toLocaleDateString()}
                              </small>
                            </span>
                            <Button
                              disabled={busy}
                              variant="secondary"
                              onClick={() =>
                                void mutate(`/${detail.workspace.id}/invitations`, 'POST', {
                                  email: invitation.email,
                                  role: invitation.role,
                                })
                              }
                            >
                              Resend invitation
                            </Button>
                            <Button
                              disabled={busy}
                              variant="ghost"
                              onClick={() =>
                                setConfirm({
                                  title: `Revoke invitation for ${invitation.email}?`,
                                  path: `/${detail.workspace.id}/invitations/${invitation.id}`,
                                  method: 'DELETE',
                                })
                              }
                            >
                              Revoke invitation
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : null}
                {detail.permissions.leave ? (
                  <Button
                    disabled={busy}
                    variant="secondary"
                    onClick={() =>
                      setConfirm({
                        title: 'Leave this workspace?',
                        path: `/${detail.workspace.id}/leave`,
                        method: 'POST',
                      })
                    }
                  >
                    Leave workspace
                  </Button>
                ) : (
                  <p>The Owner cannot leave or transfer ownership in this phase.</p>
                )}
                {detail.permissions.delete ? (
                  <Button
                    disabled={busy}
                    variant="ghost"
                    onClick={() =>
                      setConfirm({
                        title: `Permanently delete ${detail.workspace.name}, its projects, tasks, comments, memberships and invitations?`,
                        path: `/${detail.workspace.id}`,
                        method: 'DELETE',
                      })
                    }
                  >
                    Delete workspace
                  </Button>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
      {confirm ? (
        <ConfirmAction
          title={confirm.title}
          busy={pending}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void mutate(confirm.path, confirm.method)}
        />
      ) : null}
    </section>
  );
}

function RenameForm({
  name,
  busy,
  onSave,
}: {
  name: string;
  busy: boolean;
  onSave: (name: string) => void;
}) {
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);
  return (
    <Form aria-label="Rename workspace" onSubmit={() => onSave(value.trim())}>
      <FormField
        label="Workspace name"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        required
        minLength={2}
        maxLength={100}
        disabled={busy}
      />
      <Button type="submit" disabled={busy}>
        Rename workspace
      </Button>
    </Form>
  );
}
function MemberRow({
  member,
  roles,
  busy,
  onRole,
  onRemove,
}: {
  member: Membership;
  roles: Role[];
  busy: boolean;
  onRole: (role: Role) => void;
  onRemove: () => void;
}) {
  const [role, setRole] = useState(member.role);
  return (
    <li>
      <span>
        {member.user.name}
        <small>
          {member.user.email} — {member.role}
        </small>
      </span>
      {roles.length ? (
        <>
          <label>
            Role for {member.user.name}
            <select
              aria-label={`Role for ${member.user.email}`}
              value={role}
              disabled={busy}
              onChange={(event) => setRole(parseRole(event.target.value))}
            >
              {roles.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
          <Button disabled={busy || role === member.role} onClick={() => onRole(role)}>
            Save role
          </Button>
          <Button disabled={busy} variant="ghost" onClick={onRemove}>
            Remove member
          </Button>
        </>
      ) : null}
    </li>
  );
}
function ConfirmAction({
  title,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useModalDialog(true);
  return (
    <dialog
      className="workspace-confirm"
      ref={ref}
      aria-label="Confirm workspace action"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h3>{title}</h3>
      <p>This changes workspace access. You may need a new invitation to rejoin.</p>
      <Button variant="secondary" disabled={busy} onClick={onCancel}>
        Cancel
      </Button>
      <Button loading={busy} onClick={onConfirm}>
        Confirm
      </Button>
    </dialog>
  );
}
