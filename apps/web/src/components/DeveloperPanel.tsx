import { useEffect } from 'react';

import { TerminalWindowIcon, XIcon } from './icons';

interface DeveloperPanelProps {
  coreStatus: string;
  onClose: () => void;
  open: boolean;
}

export function DeveloperPanel({ coreStatus, onClose, open }: DeveloperPanelProps) {
  useEffect(() => {
    if (!open) return;

    function handleEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="developer-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-label="Developer system panel"
        aria-modal="true"
        className="developer-panel"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <span>
            <TerminalWindowIcon aria-hidden="true" size={20} />
            System status
          </span>
          <button aria-label="Close developer system panel" onClick={onClose} type="button">
            <XIcon size={18} />
          </button>
        </header>
        <dl>
          <div>
            <dt>AI Core</dt>
            <dd>{coreStatus}</dd>
          </div>
          <div>
            <dt>Mode</dt>
            <dd>Foundation</dd>
          </div>
          <div>
            <dt>Memory</dt>
            <dd>Planned</dd>
          </div>
          <div>
            <dt>Agents</dt>
            <dd>Planned</dd>
          </div>
        </dl>
        <p>No production AI services are active in this phase.</p>
      </section>
    </div>
  );
}
