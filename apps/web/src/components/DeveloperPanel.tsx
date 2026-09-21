import { useModalDialog } from './use-modal-dialog';

import { TerminalWindowIcon, XIcon } from './icons';

interface DeveloperPanelProps {
  coreStatus: string;
  onClose: () => void;
  open: boolean;
}

export function DeveloperPanel({ coreStatus, onClose, open }: DeveloperPanelProps) {
  const dialogRef = useModalDialog(open);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-label="Developer system panel"
      aria-modal="true"
      className="developer-panel"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
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
          <dt>API readiness</dt>
          <dd>{coreStatus}</dd>
        </div>
        <div>
          <dt>Mode</dt>
          <dd>Workspace product</dd>
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
    </dialog>
  );
}
