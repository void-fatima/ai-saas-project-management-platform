import type { ReactNode } from 'react';

import {
  BrainIcon,
  CaretDownIcon,
  DatabaseIcon,
  FileTextIcon,
  FolderIcon,
  GearSixIcon,
  LightningIcon,
  PlugsConnectedIcon,
  RobotIcon,
  ShieldCheckIcon,
  SquaresFourIcon,
} from './icons';

interface NavigationItem {
  icon: ReactNode;
  label: string;
  state: 'active' | 'planned';
}

interface NavigationGroup {
  items: NavigationItem[];
  label: string;
}

const navigationGroups: NavigationGroup[] = [
  {
    label: 'Core',
    items: [
      { icon: <SquaresFourIcon size={19} />, label: 'Overview', state: 'active' },
      { icon: <BrainIcon size={19} />, label: 'Intelligence', state: 'planned' },
      { icon: <RobotIcon size={19} />, label: 'Agents', state: 'planned' },
      { icon: <DatabaseIcon size={19} />, label: 'Memory', state: 'planned' },
    ],
  },
  {
    label: 'Build',
    items: [
      { icon: <FolderIcon size={19} />, label: 'Projects', state: 'planned' },
      { icon: <LightningIcon size={19} />, label: 'Automations', state: 'planned' },
      { icon: <PlugsConnectedIcon size={19} />, label: 'Integrations', state: 'planned' },
    ],
  },
  {
    label: 'System',
    items: [
      { icon: <FileTextIcon size={19} />, label: 'Logs', state: 'planned' },
      { icon: <ShieldCheckIcon size={19} />, label: 'Security', state: 'planned' },
      { icon: <GearSixIcon size={19} />, label: 'Settings', state: 'planned' },
    ],
  },
];

export function Sidebar() {
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
        {navigationGroups.map((group) => (
          <section className="navigation__group" key={group.label}>
            <h2 className="navigation__label">{group.label}</h2>
            <ul className="navigation__list">
              {group.items.map((item) => (
                <li key={item.label}>
                  <button
                    aria-current={item.state === 'active' ? 'page' : undefined}
                    className={`navigation__item navigation__item--${item.state}`}
                    disabled={item.state === 'planned'}
                    type="button"
                  >
                    {item.icon}
                    <span>{item.label}</span>
                    {item.state === 'planned' ? <small>Planned</small> : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>

      <button className="environment" type="button">
        <span className="environment__avatar" aria-hidden="true">
          D
        </span>
        <span>
          <strong>Development</strong>
          <small>Local environment</small>
        </span>
        <CaretDownIcon aria-hidden="true" size={15} />
      </button>
    </aside>
  );
}
