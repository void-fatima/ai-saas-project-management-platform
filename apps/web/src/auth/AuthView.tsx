import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { LockIcon, ShieldCheckIcon } from '../components/icons';
import { Button } from '../components/ui/Button';
import { Form } from '../components/ui/Form';
import { FormField } from '../components/ui/FormField';
import { AuthApiError, login, register } from './auth-api';
import {
  fieldGuidance,
  validateAuthInput,
  type AuthField,
  type AuthMode,
  type FieldErrors,
  type RegisterInput,
} from './auth-validation';
import './auth.css';

interface AuthViewProps {
  onBack: () => void;
}

export function AuthView({ onBack }: AuthViewProps) {
  const [mode, setMode] = useState<AuthMode>('login');

  return (
    <main className="auth-page">
      <div className="auth-layout">
        <aside className="auth-intro" aria-label="Project Platform">
          <p className="eyebrow">Project Platform</p>
          <div className="auth-emblem" aria-hidden="true">
            <LockIcon size={36} weight="duotone" />
          </div>
          <h2>Your next chapter starts here.</h2>
          <p>A dedicated place for your ideas and the work ahead.</p>
          <span className="auth-security">
            <ShieldCheckIcon aria-hidden="true" size={20} />
            Secure account access
          </span>
        </aside>
        <AuthForm key={mode} mode={mode} onBack={onBack} onModeChange={setMode} />
      </div>
    </main>
  );
}

interface AuthFormProps extends AuthViewProps {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
}

type Feedback = { kind: 'error' | 'success'; message: string };

function AuthForm({ mode, onBack, onModeChange }: AuthFormProps) {
  const isRegister = mode === 'register';
  const [values, setValues] = useState<RegisterInput>({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const fieldsRef = useRef<HTMLDivElement>(null);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const completedRef = useRef(false);
  const succeeded = feedback?.kind === 'success';

  useEffect(() => {
    fieldsRef.current?.querySelector('input')?.focus();
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, []);

  // Commit feedback and its focus together, before paint or DOM observers can discover it.
  useLayoutEffect(() => {
    if (!feedback) return;
    const invalid = fieldsRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]');
    if (invalid) invalid.focus();
    else feedbackRef.current?.focus();
  }, [feedback]);

  function changeField(field: AuthField, value: string): void {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFeedback(null);
  }

  async function submit(): Promise<void> {
    if (requestRef.current || completedRef.current) return;
    const nextErrors = validateAuthInput(mode, values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setFeedback({ kind: 'error', message: 'Please check the highlighted fields.' });
      return;
    }

    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    setPending(true);
    setFeedback(null);
    try {
      if (isRegister) await register(values, controller.signal);
      else await login(values, controller.signal);
      if (requestRef.current !== controller) return;
      completedRef.current = true;
      setValues((current) => ({ ...current, password: '' }));
      setFeedback({
        kind: 'success',
        message: isRegister ? 'Your account has been created.' : 'You’re signed in.',
      });
    } catch (error: unknown) {
      if (requestRef.current !== controller) return;
      setErrors(error instanceof AuthApiError ? error.fields : {});
      setFeedback({
        kind: 'error',
        message:
          error instanceof AuthApiError
            ? error.message
            : 'We could not complete your request. Please try again.',
      });
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) {
        requestRef.current = null;
        setPending(false);
      }
    }
  }

  return (
    <section className="auth-card" aria-labelledby="auth-title">
      <header className="auth-heading">
        <p className="eyebrow">{isRegister ? 'Get started' : 'Welcome back'}</p>
        <h1 id="auth-title">{isRegister ? 'Create your account' : 'Sign in'}</h1>
        <p>{isRegister ? 'A few details to make it yours.' : 'Enter your details to sign in.'}</p>
      </header>

      <Form
        aria-label={isRegister ? 'Register' : 'Login'}
        noValidate
        onSubmit={() => void submit()}
      >
        <div className="auth-fields" ref={fieldsRef}>
          {isRegister ? (
            <FormField
              autoComplete="name"
              disabled={pending || succeeded}
              error={errors.name}
              hint={fieldGuidance.name}
              label="Name"
              name="name"
              onChange={(event) => changeField('name', event.target.value)}
              required
              value={values.name}
            />
          ) : null}
          <FormField
            autoCapitalize="none"
            autoComplete="username"
            disabled={pending || succeeded}
            error={errors.email}
            hint="Use the email address for your account."
            inputMode="email"
            label="Email"
            name="email"
            onChange={(event) => changeField('email', event.target.value)}
            required
            spellCheck={false}
            type="email"
            value={values.email}
          />
          <FormField
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            disabled={pending || succeeded}
            error={errors.password}
            hint={isRegister ? fieldGuidance.registerPassword : fieldGuidance.loginPassword}
            label="Password"
            name="password"
            onChange={(event) => changeField('password', event.target.value)}
            required
            type="password"
            value={values.password}
          />
        </div>

        <div className="auth-feedback">
          <p
            className={feedback ? `auth-feedback--${feedback.kind}` : undefined}
            ref={feedbackRef}
            role={feedback?.kind === 'error' ? 'alert' : 'status'}
            tabIndex={-1}
          >
            {pending ? (isRegister ? 'Creating your account…' : 'Signing in…') : feedback?.message}
          </p>
        </div>

        {succeeded ? (
          <Button className="auth-submit" onClick={onBack}>
            Back to overview
          </Button>
        ) : (
          <Button className="auth-submit" loading={pending} type="submit">
            {pending
              ? isRegister
                ? 'Creating account…'
                : 'Signing in…'
              : isRegister
                ? 'Create account'
                : 'Sign in'}
          </Button>
        )}
      </Form>

      {!succeeded ? (
        <footer className="auth-footer">
          <p>{isRegister ? 'Already have an account?' : 'New to Project Platform?'}</p>
          <Button
            disabled={pending}
            onClick={() => onModeChange(isRegister ? 'login' : 'register')}
            variant="secondary"
          >
            {isRegister ? 'Sign in instead' : 'Create an account'}
          </Button>
          <Button disabled={pending} onClick={onBack} variant="ghost">
            Back to overview
          </Button>
        </footer>
      ) : null}
    </section>
  );
}
