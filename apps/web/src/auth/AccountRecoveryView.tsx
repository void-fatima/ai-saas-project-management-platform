import { useEffect, useRef, useState } from 'react';
import { apiUrl } from '../api/config';
import { Button } from '../components/ui/Button';
import { Form } from '../components/ui/Form';
import { FormField } from '../components/ui/FormField';
import { fieldGuidance, validateAuthInput } from './auth-validation';
import './auth.css';

export type AccountAction = 'forgot' | 'reset' | 'verify' | 'resend';

export function AccountRecoveryView({
  action,
  token = '',
  initialEmail = '',
  onBack,
  onSuccess,
}: {
  action: AccountAction;
  token?: string;
  initialEmail?: string;
  onBack: () => void;
  onSuccess: () => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(false);
  const request = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const title = {
    forgot: 'Forgot password',
    reset: 'Reset password',
    verify: 'Verify your email',
    resend: 'Send verification email',
  }[action];
  useEffect(() => {
    heading.current?.focus();
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, []);

  async function submit() {
    if (request.current || done) return;
    if (action === 'forgot' || action === 'resend') {
      if (validateAuthInput('login', { name: '', email, password: 'x' }).email) {
        setMessage(fieldGuidance.email);
        return;
      }
    }
    if (
      action === 'reset' &&
      validateAuthInput('register', { name: 'Account', email: 'account@example.com', password })
        .password
    ) {
      setMessage(fieldGuidance.registerPassword);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 15_000);
    setPending(true);
    setMessage('');
    try {
      const endpoint = {
        forgot: 'forgot-password',
        reset: 'reset-password',
        verify: 'verify-email',
        resend: 'resend-verification',
      }[action];
      const body =
        action === 'forgot' || action === 'resend'
          ? { email }
          : action === 'reset'
            ? { token, password }
            : { token };
      const response = await fetch(`${apiUrl}/auth/${endpoint}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (request.current !== controller) return;
      if (!response.ok) {
        setMessage(
          response.status === 400
            ? 'This link is invalid, expired, or already used. Request a new link.'
            : response.status === 429
              ? 'Too many requests. Wait a minute and retry.'
              : response.status === 403
                ? 'This request is not permitted.'
                : 'The service or email delivery is temporarily unavailable. Please retry.',
        );
        return;
      }
      setPassword('');
      setDone(true);
      setMessage(
        action === 'reset'
          ? 'Password changed. All devices are signed out. Sign in with your new password.'
          : action === 'verify'
            ? 'Your email is verified.'
            : 'If the account is eligible, an email will be delivered. Check your inbox and wait a minute before requesting another.',
      );
      onSuccess();
    } catch {
      if (request.current === controller)
        setMessage('Unable to connect or the request timed out. Please retry.');
    } finally {
      window.clearTimeout(timer);
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1 ref={heading} tabIndex={-1}>
          {title}
        </h1>
        <Form aria-label={title} onSubmit={() => void submit()} noValidate>
          {action === 'forgot' || action === 'resend' ? (
            <FormField
              label="Email"
              type="email"
              autoComplete="email"
              value={email}
              disabled={pending || done}
              onChange={(event) => setEmail(event.target.value)}
            />
          ) : null}
          {action === 'reset' ? (
            <FormField
              label="New password"
              type="password"
              autoComplete="new-password"
              hint={fieldGuidance.registerPassword}
              value={password}
              disabled={pending || done}
              onChange={(event) => setPassword(event.target.value)}
            />
          ) : null}
          {action === 'verify' ? (
            <p>Confirm to verify the email address linked to this one-time link.</p>
          ) : null}
          {message ? <p role={done ? 'status' : 'alert'}>{message}</p> : null}
          {!done ? (
            <Button type="submit" loading={pending}>
              {title}
            </Button>
          ) : null}
          <Button variant="secondary" disabled={pending} onClick={onBack}>
            {done ? 'Continue' : 'Back to sign in'}
          </Button>
        </Form>
      </section>
    </main>
  );
}
