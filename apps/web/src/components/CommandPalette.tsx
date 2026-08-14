import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import {
  ArrowClockwiseIcon,
  BrainIcon,
  FileTextIcon,
  FolderIcon,
  LightningIcon,
  MagnifyingGlassIcon,
  RobotIcon,
  XIcon,
} from './icons';

interface CommandPaletteProps {
  onClose: () => void;
  onFocusApi: () => void;
  onRefresh: () => void;
  open: boolean;
}

interface Command {
  action?: () => void;
  icon: ReactNode;
  label: string;
  planned?: boolean;
}

export function CommandPalette({ onClose, onFocusApi, onRefresh, open }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(
    () => [
      { action: onRefresh, icon: <ArrowClockwiseIcon size={19} />, label: 'Refresh system status' },
      { action: onFocusApi, icon: <MagnifyingGlassIcon size={19} />, label: 'View API connection' },
      { icon: <RobotIcon size={19} />, label: 'Create Agent', planned: true },
      { icon: <FileTextIcon size={19} />, label: 'Generate Report', planned: true },
      { icon: <FolderIcon size={19} />, label: 'Open Projects', planned: true },
      { icon: <BrainIcon size={19} />, label: 'View Memory', planned: true },
      { icon: <LightningIcon size={19} />, label: 'Run Automation', planned: true },
    ],
    [onFocusApi, onRefresh],
  );

  const filteredCommands = commands.filter((command) =>
    command.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const actionableCommands = filteredCommands.filter((command) => !command.planned);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handleEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose, open]);

  if (!open) return null;

  function runCommand(command: Command): void {
    if (!command.action || command.planned) return;
    command.action();
    onClose();
  }

  return (
    <div className="command-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-label="Command palette"
        aria-modal="true"
        className="command-palette"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="command-palette__search">
          <MagnifyingGlassIcon aria-hidden="true" size={21} />
          <input
            aria-label="Search AI workspace"
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((index) =>
                  Math.min(index + 1, Math.max(0, actionableCommands.length - 1)),
                );
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
              }
              if (event.key === 'Enter' && actionableCommands[activeIndex]) {
                runCommand(actionableCommands[activeIndex]);
              }
            }}
            placeholder="Search AI workspace..."
            ref={inputRef}
            value={query}
          />
          <button aria-label="Close command palette" onClick={onClose} type="button">
            <XIcon size={18} />
          </button>
        </div>

        <div className="command-palette__body">
          <p className="command-palette__label">Actions</p>
          {filteredCommands.length ? (
            <ul className="command-list">
              {filteredCommands.map((command) => {
                const actionableIndex = actionableCommands.indexOf(command);
                const active = !command.planned && actionableIndex === activeIndex;
                return (
                  <li key={command.label}>
                    <button
                      aria-disabled={command.planned || undefined}
                      aria-label={command.label}
                      className={active ? 'is-active' : ''}
                      onClick={() => runCommand(command)}
                      type="button"
                    >
                      {command.icon}
                      <span>{command.label}</span>
                      {command.planned ? <small>Planned</small> : <kbd>Enter</kbd>}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="command-palette__empty">No matching commands.</p>
          )}
        </div>
        <footer className="command-palette__footer">
          <span>Arrow keys to navigate</span>
          <span>Enter to select</span>
          <span>Esc to close</span>
        </footer>
      </section>
    </div>
  );
}
