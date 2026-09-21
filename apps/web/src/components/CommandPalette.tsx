import { useCallback, useState } from 'react';
import { useModalDialog } from './use-modal-dialog';
import { MagnifyingGlassIcon, XIcon } from './icons';
import { Button } from './ui/Button';
import {
  discoveryRequest,
  parseSearch,
  resourceLink,
  type SearchResult,
} from '../discovery/discovery-api';
import { useDiscoveryData } from '../discovery/use-discovery-data';
import { WorkspacePicker } from '../discovery/WorkspaceDashboard';
import { useCollaborationUpdates } from '../collaboration/use-realtime';

interface CommandPaletteProps {
  onClose: () => void;
  onFocusApi: () => void;
  onRefresh: () => void;
  open: boolean;
  workspaceId: string;
  onWorkspaceChange: (id: string) => void;
  navigate?: (href: string) => void;
}
const navigateTo = (href: string) => window.location.assign(href);
const kindLabels = { PROJECT: 'Project', TASK: 'Task', SUBTASK: 'Subtask' };

export function CommandPalette(props: CommandPaletteProps) {
  return props.open ? <SearchDialog {...props} /> : null;
}
function SearchDialog({
  onClose,
  onFocusApi,
  onRefresh,
  workspaceId,
  onWorkspaceChange,
  navigate = navigateTo,
}: CommandPaletteProps) {
  const dialog = useModalDialog(true);
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [archived, setArchived] = useState(false);
  const [selection, setSelection] = useState({ key: '', index: 0 });
  const normalized = query.trim().replace(/\s+/gu, ' ');
  const valid = normalized.length >= 2 && normalized.length <= 100;
  const key = JSON.stringify([workspaceId, normalized, archived, offset]);
  const read = useCallback(
    async (signal: AbortSignal) => {
      const params = new URLSearchParams({
        q: normalized,
        includeArchived: String(archived),
        offset: String(offset),
      });
      return parseSearch(
        await discoveryRequest('/' + workspaceId + '/search?' + params.toString(), signal),
      );
    },
    [workspaceId, normalized, archived, offset],
  );
  const state = useDiscoveryData(key, read, 250, !!workspaceId && valid);
  useCollaborationUpdates(workspaceId, () => state.reload(true));
  const commands = !normalized
    ? [
        { label: 'Refresh system status', action: onRefresh },
        { label: 'View API connection', action: onFocusApi },
        {
          label: 'Open Projects',
          action: () =>
            navigate(
              '/?' +
                new URLSearchParams({
                  view: 'projects',
                  ...(workspaceId ? { workspace: workspaceId } : {}),
                }).toString(),
            ),
        },
      ]
    : [];
  const results = valid && workspaceId ? (state.data?.items ?? []) : [];
  const options: { label: string; action: () => void; item?: SearchResult }[] = [
    ...commands,
    ...results.map((item) => ({
      label: kindLabels[item.kind] + ': ' + item.title,
      action: () => navigate(resourceLink(workspaceId, item)),
      item,
    })),
  ];
  const active =
    selection.key === key ? Math.min(selection.index, Math.max(0, options.length - 1)) : 0;
  function run(index: number) {
    const option = options[index];
    if (!option) return;
    onClose();
    option.action();
  }
  return (
    <dialog
      ref={dialog}
      aria-label="Command palette"
      aria-modal="true"
      className="command-palette"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="command-palette__search">
        <MagnifyingGlassIcon aria-hidden="true" size={21} />
        <input
          aria-label="Search workspace"
          role="combobox"
          aria-expanded="true"
          aria-controls="command-options"
          aria-autocomplete="list"
          aria-activedescendant={options[active] ? 'command-option-' + active : undefined}
          maxLength={200}
          value={query}
          placeholder="Search projects, tasks and subtasks…"
          onChange={(event) => {
            setQuery(event.target.value);
            setOffset(0);
            setSelection({ key: '', index: 0 });
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setSelection({
                key,
                index: Math.max(
                  0,
                  Math.min(options.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)),
                ),
              });
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              run(active);
            }
          }}
        />
      </div>
      <div className="command-palette__body">
        <WorkspacePicker
          workspaceId={workspaceId}
          label="Search workspace scope"
          onSelect={(id) => {
            setOffset(0);
            onWorkspaceChange(id);
          }}
        />
        <label className="search-archive">
          <input
            type="checkbox"
            checked={archived}
            onChange={(event) => {
              setArchived(event.target.checked);
              setOffset(0);
            }}
          />
          Include archived projects
        </label>
        <p className="command-palette__label">{normalized ? 'Workspace results' : 'Actions'}</p>
        {normalized && !workspaceId ? <p>Select a workspace to search.</p> : null}
        {normalized && !valid ? <p>Use between 2 and 100 characters.</p> : null}
        <p aria-live="polite" aria-atomic="true">
          {normalized && workspaceId && valid
            ? state.loading
              ? 'Searching…'
              : state.error
                ? ''
                : results.length
                  ? results.length + ' results on this page.'
                  : 'No results in this workspace.'
            : ''}
        </p>
        {state.error && valid && workspaceId ? (
          <>
            <p role="alert">{state.error}</p>
            <Button onClick={() => state.reload()}>Retry search</Button>
          </>
        ) : null}
        <ul
          className="command-list"
          role="listbox"
          id="command-options"
          aria-label={normalized ? 'Search results' : 'Commands'}
        >
          {options.map((option, index) => (
            <li role="presentation" key={option.item ? option.item.id : option.label}>
              <button
                role="option"
                id={'command-option-' + index}
                aria-selected={active === index}
                aria-label={option.label}
                tabIndex={-1}
                className={active === index ? 'is-active' : ''}
                type="button"
                onClick={() => run(index)}
              >
                <span>
                  {option.label}
                  {option.item ? (
                    <>
                      <small>{option.item.snippet}</small>
                      <small>
                        {option.item.archived ? 'Archived · ' : ''}
                        {new Date(option.item.updatedAt).toLocaleDateString()}
                      </small>
                    </>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {valid && workspaceId ? (
          <div className="project-toolbar">
            {offset > 0 ? (
              <Button
                disabled={state.loading && !state.data}
                onClick={() => setOffset(Math.max(0, offset - 20))}
              >
                Previous results
              </Button>
            ) : null}
            {state.data?.nextOffset != null ? (
              <Button
                disabled={state.loading && !state.data}
                onClick={() => setOffset(state.data?.nextOffset ?? 0)}
              >
                Next results
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <footer className="command-palette__footer">
        <span>↑↓ to navigate · Enter to select · Esc to close</span>
        <button aria-label="Close command palette" type="button" onClick={onClose}>
          <XIcon size={18} />
        </button>
      </footer>
    </dialog>
  );
}
