import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/Button';
import { WorkspaceError, workspaceRequest } from './workspace-api';
import './workspace.css';

export function InvitationView({
  token,
  email,
  onBack,
  onAccepted,
}: {
  token: string;
  email: string;
  onBack: () => void;
  onAccepted: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, []);
  async function accept() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 15_000);
    setPending(true);
    setError('');
    try {
      await workspaceRequest('/invitations/accept', 'POST', { token }, controller.signal);
      if (active.current === controller) onAccepted();
    } catch (cause: unknown) {
      if (active.current === controller)
        setError(
          cause instanceof WorkspaceError
            ? cause.message
            : 'Unable to accept invitation. Please retry.',
        );
    } finally {
      window.clearTimeout(timer);
      if (active.current === controller) {
        active.current = null;
        setPending(false);
      }
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1 ref={heading} tabIndex={-1}>
          Join workspace
        </h1>
        <p>Accept this invitation as {email}. The invitation must be addressed to this email.</p>
        {error ? <p role="alert">{error}</p> : null}
        <Button loading={pending} onClick={() => void accept()}>
          Accept invitation
        </Button>
        <Button variant="secondary" disabled={pending} onClick={onBack}>
          Back to account
        </Button>
      </section>
    </main>
  );
}
