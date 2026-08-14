import type { ReactNode } from 'react';

import workspaceBranches from '../assets/workspace-branches.png';
import workspaceOrbitalHalo from '../assets/workspace-orbital-halo.png';
import { CubeIcon, DatabaseIcon, FolderIcon, HexagonIcon, LightningIcon, RobotIcon } from './icons';

interface EcosystemNode {
  icon: ReactNode;
  label: string;
  tone: 'blue' | 'lavender' | 'mint' | 'peach';
}

const nodes: EcosystemNode[] = [
  { icon: <RobotIcon size={26} weight="duotone" />, label: 'Agents', tone: 'lavender' },
  { icon: <DatabaseIcon size={26} weight="duotone" />, label: 'Memory', tone: 'blue' },
  { icon: <FolderIcon size={26} weight="duotone" />, label: 'Projects', tone: 'mint' },
  { icon: <LightningIcon size={26} weight="duotone" />, label: 'Automations', tone: 'peach' },
];

export function WorkspaceEcosystem() {
  return (
    <section className="ecosystem" aria-labelledby="ecosystem-title">
      <header className="section-heading">
        <p className="eyebrow">Architecture map</p>
        <h2 id="ecosystem-title">Workspace ecosystem</h2>
      </header>

      <div className="ecosystem__diagram">
        <span aria-hidden="true" className="ecosystem__halo-stack">
          <img
            alt=""
            className="ecosystem__halo ecosystem__halo--base"
            src={workspaceOrbitalHalo}
          />
        </span>

        <div className="ecosystem__core">
          <span className="ecosystem__core-icon" aria-hidden="true">
            <HexagonIcon className="ecosystem__core-frame" size={63} weight="duotone" />
            <CubeIcon className="ecosystem__core-cube" size={28} weight="duotone" />
          </span>
          <strong>AI Core</strong>
          <span className="status-inline status-inline--online">Operational</span>
        </div>

        <img alt="" aria-hidden="true" className="ecosystem__branches" src={workspaceBranches} />

        <ul className="ecosystem__nodes">
          {nodes.map((node) => (
            <li className={`ecosystem__node ecosystem__node--${node.tone}`} key={node.label}>
              <span className="ecosystem__node-icon" aria-hidden="true">
                {node.icon}
              </span>
              <strong>{node.label}</strong>
              <small>Planned</small>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
