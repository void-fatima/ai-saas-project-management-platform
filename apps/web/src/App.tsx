import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import { apiUrl } from './api/config';
import { AuthView } from './auth/AuthView';
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

type ApiStatus = 'checking' | 'available' | 'unavailable';
type CoreStatus = 'online' | 'processing' | 'warning';

const developerUnlockClicks = 5;

const coreStatusCopy: Record<CoreStatus, { description: string; label: string }> = {
  online: {
    description: 'Core services are connected. Sign in or create your account to get started.',
    label: 'Online',
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
  const [showAuth, setShowAuth] = useState(false);
  const signInRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (!showAuth && returnFocus.current) {
      signInRef.current?.focus();
      returnFocus.current = false;
    }
  }, [showAuth]);

  if (showAuth) {
    return <AuthView onBack={() => setShowAuth(false)} />;
  }
  return (
    <Observatory
      signInRef={signInRef}
      onSignIn={() => {
        returnFocus.current = true;
        setShowAuth(true);
      }}
    />
  );
}

function Observatory({
  onSignIn,
  signInRef,
}: {
  onSignIn: () => void;
  signInRef: RefObject<HTMLButtonElement | null>;
}) {
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [coreClicks, setCoreClicks] = useState(0);
  const [developerPanelOpen, setDeveloperPanelOpen] = useState(false);
  const apiSectionRef = useRef<HTMLElement>(null);

  const checkApi = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setApiStatus('checking');

    try {
      const response = await fetch(`${apiUrl}/health`, { signal });
      setApiStatus(response.ok ? 'available' : 'unavailable');
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setApiStatus('unavailable');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void checkApi(controller.signal);
    return () => controller.abort();
  }, [checkApi]);

  useEffect(() => {
    function handleCommandShortcut(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
    }

    window.addEventListener('keydown', handleCommandShortcut);
    return () => window.removeEventListener('keydown', handleCommandShortcut);
  }, []);

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

      <main className="observatory">
        <header className="topbar">
          <div>
            <p className="eyebrow">Foundation / Overview</p>
            <h1>AI System Observatory</h1>
          </div>
          <div className="topbar__actions">
            <Button onClick={onSignIn} ref={signInRef} variant="secondary">
              Sign in
            </Button>
            <SystemClock />
            <div className="input-container">
              <span aria-hidden="true" className="input-container__surface">
                <span className="input-container__placeholder">Search AI workspace...</span>
              </span>
              <input
                aria-label="Open AI workspace search"
                autoComplete="off"
                className="command-search-input"
                name="workspace-search"
                onClick={() => setCommandPaletteOpen(true)}
                onFocus={() => setCommandPaletteOpen(true)}
                placeholder="Search AI workspace..."
                readOnly
                type="text"
              />
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
                  <dd className="status-inline status-inline--online">Verified</dd>
                </div>
                <div>
                  <dt>
                    <CheckCircleIcon aria-hidden="true" size={19} />
                    Foundation
                  </dt>
                  <dd>Complete</dd>
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
                <small>Issue 03 API contract · Issue 04 interface</small>
              </span>
            </div>
          </section>

          <section className="last-updated" aria-label="Last updated">
            <ClockIcon aria-hidden="true" size={18} />
            <span>
              <small>Current phase</small>
              <strong>Foundation complete</strong>
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
