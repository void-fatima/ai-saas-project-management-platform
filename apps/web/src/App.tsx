import { useEffect, useRef, useState } from 'react';

import { apiUrl } from './api/config';
import { useHealth } from './api/use-health';
import { AuthView } from './auth/AuthView';
import { AccountRecoveryView, type AccountAction } from './auth/AccountRecoveryView';
import { useSession } from './auth/use-session';
import type { SessionUser } from './auth/session-api';
import aiCoreOrb from './assets/ai-core-orb.png';
import aiCoreOrbits from './assets/ai-core-orbits.png';
import { ActivityFeed } from './components/ActivityFeed';
import { CommandPalette } from './components/CommandPalette';
import { DeveloperPanel } from './components/DeveloperPanel';
import {
  ArrowClockwiseIcon,
  BellIcon,
  CheckCircleIcon,
  ClockIcon,
  LockIcon,
  PulseIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
} from './components/icons';
import { Sidebar } from './components/Sidebar';
import { SystemClock } from './components/SystemClock';
import { WorkspaceEcosystem } from './components/WorkspaceEcosystem';
import { Button } from './components/ui/Button';
import { Form } from './components/ui/Form';
import { FormField } from './components/ui/FormField';

type CoreStatus = 'online' | 'processing' | 'warning';

const developerUnlockClicks = 5;

function readAccountLink(): { action: AccountAction; token: string } | null {
  const match = /^#(verify|reset)=(.*)$/.exec(window.location.hash);
  return match
    ? { action: match[1] === 'verify' ? 'verify' : 'reset', token: match[2] ?? '' }
    : null;
}

const coreStatusCopy: Record<CoreStatus, { description: string; label: string }> = {
  online: {
    description: 'The API and database readiness check succeeded. AI capabilities remain planned.',
    label: 'API connected',
  },
  processing: {
    description: 'The observatory is checking the configured service connection.',
    label: 'Processing',
  },
  warning: {
    description: 'The interface is online, but the configured API needs attention.',
    label: 'Warning',
  },
};

export function App() {
  const session = useSession();
  const [welcome, setWelcome] = useState(false);
  const [accountAction, setAccountAction] = useState<{
    action: AccountAction;
    token?: string;
  } | null>(readAccountLink);
  useEffect(() => {
    function consumeLink() {
      const action = readAccountLink();
      if (action) {
        setAccountAction(action);
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    }
    consumeLink();
    window.addEventListener('hashchange', consumeLink);
    return () => window.removeEventListener('hashchange', consumeLink);
  }, []);
  if (accountAction)
    return (
      <AccountRecoveryView
        key={`${accountAction.action}:${accountAction.token ?? ''}`}
        {...accountAction}
        initialEmail={session.state.user?.email}
        onBack={() => setAccountAction(null)}
        onSuccess={() => {
          if (accountAction.action === 'reset') session.clear();
          if (accountAction.action === 'verify') void session.refresh();
        }}
      />
    );
  if (session.state.status === 'checking') {
    return (
      <main className="auth-page">
        <p role="status">Checking your session…</p>
      </main>
    );
  }
  if (!session.state.user) {
    if (session.state.status === 'service-failure') {
      return (
        <main className="auth-page">
          <section className="auth-card">
            <h1>Connection interrupted</h1>
            <p role="alert">{session.state.message}</p>
            <Button loading={session.pending} onClick={() => void session.refresh()}>
              Retry session check
            </Button>
          </section>
        </main>
      );
    }
    if (welcome) {
      return (
        <main className="auth-page">
          <section className="auth-card">
            <h1>Project Platform</h1>
            <p>Sign in to access your account.</p>
            <Button onClick={() => setWelcome(false)}>Sign in</Button>
          </section>
        </main>
      );
    }
    return (
      <AuthView
        onBack={() => setWelcome(true)}
        onAuthenticated={session.accept}
        onForgot={() => setAccountAction({ action: 'forgot' })}
      />
    );
  }
  return (
    <Observatory
      key={session.state.user.id}
      user={session.state.user}
      onVerify={() => setAccountAction({ action: 'resend' })}
      pending={session.pending}
      onLogout={(all) => void session.logout(all)}
      onRefreshSession={() => void session.refresh()}
      error={session.state.status === 'service-failure' ? session.state.message : undefined}
    />
  );
}

function Observatory({
  user,
  onVerify,
  pending,
  onLogout,
  onRefreshSession,
  error,
}: {
  user: SessionUser;
  onVerify: () => void;
  pending: boolean;
  onLogout: (all: boolean) => void;
  onRefreshSession: () => void;
  error?: string;
}) {
  const { status: apiStatus, check: checkApi } = useHealth();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [coreClicks, setCoreClicks] = useState(0);
  const [developerPanelOpen, setDeveloperPanelOpen] = useState(false);
  const apiSectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    function handleCommandShortcut(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (!developerPanelOpen) setCommandPaletteOpen(true);
      }
    }

    window.addEventListener('keydown', handleCommandShortcut);
    return () => window.removeEventListener('keydown', handleCommandShortcut);
  }, [developerPanelOpen]);

  const coreStatus: CoreStatus =
    apiStatus === 'checking' ? 'processing' : apiStatus === 'available' ? 'online' : 'warning';
  const coreCopy = coreStatusCopy[coreStatus];

  function handleCoreClick(): void {
    const nextCount = coreClicks + 1;
    if (nextCount >= developerUnlockClicks) {
      setDeveloperPanelOpen(true);
      setCoreClicks(0);
      return;
    }
    setCoreClicks(nextCount);
  }

  function focusApiConnection(): void {
    apiSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    requestAnimationFrame(() => apiSectionRef.current?.querySelector('input')?.focus());
  }

  return (
    <div className="app-shell">
      <Sidebar />

      <main className="observatory" id="overview" tabIndex={-1}>
        <header className="topbar">
          <div>
            <p className="eyebrow">Foundation / Overview</p>
            <h1>AI System Observatory</h1>
          </div>
          <div className="topbar__actions">
            <span aria-label="Signed-in account">{user.name}</span>
            {!user.emailVerified ? (
              <Button variant="secondary" onClick={onVerify}>
                Verify email
              </Button>
            ) : (
              <span>Email verified</span>
            )}
            <Button disabled={pending} onClick={() => onLogout(false)} variant="secondary">
              Sign out
            </Button>
            <Button disabled={pending} onClick={() => onLogout(true)} variant="ghost">
              Sign out all devices
            </Button>
            <SystemClock />
            <div className="input-container">
              <span aria-hidden="true" className="input-container__surface">
                <span className="input-container__placeholder">Search AI workspace...</span>
              </span>
              <button
                aria-label="Open AI workspace search"
                className="command-search-input"
                onClick={() => setCommandPaletteOpen(true)}
                type="button"
              >
                Search AI workspace...
              </button>
              <span aria-hidden="true" className="input-container__cursor">
                |
              </span>
            </div>
            <button aria-label="Notifications" className="icon-button" disabled type="button">
              <BellIcon size={19} />
            </button>
            <span className="profile-mark" aria-label="Development profile">
              P
            </span>
          </div>
        </header>

        <div className="observatory__grid">
          {error ? (
            <section role="alert">
              <p>{error}</p>
              <Button loading={pending} onClick={onRefreshSession}>
                Retry session check
              </Button>
            </section>
          ) : null}
          <section className="core-panel" aria-labelledby="core-title">
            <div className="core-panel__copy">
              <p className="eyebrow">AI Core</p>
              <h2 id="core-title">Foundation mode</h2>
              <p>{coreCopy.description}</p>

              <dl className="core-signals">
                <div>
                  <dt>
                    <PulseIcon aria-hidden="true" size={19} />
                    Core status
                  </dt>
                  <dd className={`status-inline status-inline--${coreStatus}`}>{coreCopy.label}</dd>
                </div>
                <div>
                  <dt>
                    <ShieldCheckIcon aria-hidden="true" size={19} />
                    Quality gates
                  </dt>
                  <dd>See verification record</dd>
                </div>
                <div>
                  <dt>
                    <CheckCircleIcon aria-hidden="true" size={19} />
                    Foundation
                  </dt>
                  <dd>Authentication in progress</dd>
                </div>
              </dl>
            </div>

            <button
              aria-label="Interactive AI Core"
              className={`core-visual core-visual--${coreStatus}`}
              onClick={handleCoreClick}
              type="button"
            >
              <span className="core-visual__stage">
                <img
                  aria-hidden="true"
                  alt=""
                  className="core-visual__orb core-visual__orb--orbits"
                  src={aiCoreOrbits}
                />
                <img
                  alt="Purple neural AI core with orbital processing paths"
                  className="core-visual__orb core-visual__orb--base"
                  src={aiCoreOrb}
                />
                <img
                  aria-hidden="true"
                  alt=""
                  className="core-visual__orb core-visual__orb--inner"
                  src={aiCoreOrb}
                />
              </span>
              <span className="core-visual__hint">Interactive core</span>
            </button>
          </section>

          <ActivityFeed />
          <WorkspaceEcosystem />

          <section
            className="api-connection"
            id="api-connection"
            ref={apiSectionRef}
            aria-labelledby="api-title"
          >
            <header className="section-heading section-heading--row">
              <div>
                <p className="eyebrow">System health</p>
                <h2 id="api-title">API connection</h2>
              </div>
              <span
                className={`api-state api-state--${apiStatus}`}
                role="status"
                aria-live="polite"
              >
                {apiStatus === 'available' ? (
                  <CheckCircleIcon aria-hidden="true" size={16} />
                ) : (
                  <WarningCircleIcon aria-hidden="true" size={16} />
                )}
                {apiStatus}
              </span>
            </header>

            <Form className="connection-form" onSubmit={() => void checkApi()}>
              <FormField
                hint="Configured through VITE_API_URL"
                label="API endpoint"
                readOnly
                value={apiUrl}
              />
              <Button
                aria-label="Check API connection"
                loading={apiStatus === 'checking'}
                type="submit"
                variant="secondary"
              >
                <ArrowClockwiseIcon aria-hidden="true" size={17} />
                Check
              </Button>
            </Form>
          </section>

          <section className="milestone" aria-labelledby="milestone-title">
            <header className="section-heading">
              <p className="eyebrow">Next milestone</p>
              <h2 id="milestone-title">Authentication</h2>
            </header>
            <div className="milestone__content">
              <span className="milestone__icon" aria-hidden="true">
                <LockIcon size={23} weight="duotone" />
              </span>
              <span>
                <strong>Identity and secure sessions</strong>
                <small>Account verification and recovery</small>
              </span>
            </div>
          </section>

          <section className="last-updated" aria-label="Last updated">
            <ClockIcon aria-hidden="true" size={18} />
            <span>
              <small>Current phase</small>
              <strong>Authentication hardening</strong>
            </span>
          </section>
        </div>
      </main>

      <CommandPalette
        onClose={() => setCommandPaletteOpen(false)}
        onFocusApi={focusApiConnection}
        onRefresh={() => void checkApi()}
        open={commandPaletteOpen}
      />
      <DeveloperPanel
        coreStatus={coreCopy.label}
        onClose={() => setDeveloperPanelOpen(false)}
        open={developerPanelOpen}
      />
    </div>
  );
}
