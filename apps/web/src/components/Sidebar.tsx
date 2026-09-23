import { BrainIcon, FileTextIcon, FolderIcon, SquaresFourIcon } from './icons';

export function Sidebar({
  workspacesOpen,
  projectsOpen,
  reportingOpen,
  onReporting,
  onProjects,
  onNavigate,
}: {
  workspacesOpen: boolean;
  projectsOpen: boolean;
  reportingOpen: boolean;
  onReporting: () => void;
  onProjects: () => void;
  onNavigate: (workspaces: boolean) => void;
}) {
  return (
    <aside className="sidebar">
      <div className="brand" aria-label="Project Platform">
        <span className="brand__mark" aria-hidden="true">
          <BrainIcon size={22} weight="duotone" />
        </span>
        <span className="brand__copy">
          <strong>Project Platform</strong>
          <small>Neural Observatory</small>
        </span>
      </div>

      <nav className="navigation" aria-label="Primary navigation">
        <button
          className={`navigation__item navigation__item--${workspacesOpen ? 'active' : 'available'}`}
          aria-label="Workspaces"
          title="Workspaces"
          aria-current={workspacesOpen ? 'page' : undefined}
          onClick={() => onNavigate(true)}
          type="button"
        >
          <SquaresFourIcon size={19} />
          <span>Workspaces</span>
        </button>
        <button
          className={`navigation__item navigation__item--${projectsOpen ? 'active' : 'available'}`}
          aria-label="Projects"
          title="Projects"
          aria-current={projectsOpen ? 'page' : undefined}
          onClick={onProjects}
          type="button"
        >
          <FolderIcon size={19} />
          <span>Projects</span>
        </button>
        <button
          className={`navigation__item navigation__item--${reportingOpen ? 'active' : 'available'}`}
          type="button"
          aria-current={reportingOpen ? 'page' : undefined}
          onClick={onReporting}
          aria-label="Analytics and reports"
          title="Analytics and reports"
        >
          <FileTextIcon size={19} />
          <span>Analytics and reports</span>
        </button>
        <button
          aria-label="Overview"
          title="Overview"
          onClick={() => {
            onNavigate(false);
            document.getElementById('overview')?.focus();
          }}
          aria-current={!workspacesOpen && !projectsOpen && !reportingOpen ? 'page' : undefined}
          className={`navigation__item navigation__item--${!workspacesOpen && !projectsOpen && !reportingOpen ? 'active' : 'available'}`}
          type="button"
        >
          <SquaresFourIcon size={19} />
          <span>Overview</span>
        </button>
      </nav>
    </aside>
  );
}
