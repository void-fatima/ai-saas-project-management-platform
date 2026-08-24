import type { ElementType } from 'react';

import { CheckCircleIcon, DatabaseIcon, PulseIcon } from './icons';

interface ActivityItem {
  detail: string;
  icon: ElementType;
  label: string;
  tone: 'cyan' | 'green' | 'violet';
}

const activityItems: ActivityItem[] = [
  {
    detail: 'All required quality gates passed in the latest local verification.',
    icon: CheckCircleIcon,
    label: 'Foundation quality gates passed',
    tone: 'violet',
  },
  {
    detail: 'The health endpoint check completed for the configured API.',
    icon: PulseIcon,
    label: 'API health check completed',
    tone: 'cyan',
  },
  {
    detail: 'Database connection and development workflow were verified.',
    icon: DatabaseIcon,
    label: 'PostgreSQL workflow verified',
    tone: 'green',
  },
];

export function ActivityFeed() {
  return (
    <section className="activity" aria-labelledby="activity-title">
      <header className="section-heading section-heading--row">
        <div>
          <p className="eyebrow">Monitor</p>
          <h2 id="activity-title">Live AI activity</h2>
        </div>
        <span className="demo-label">Demo data</span>
      </header>

      <ol className="activity__list">
        {activityItems.map((item, index) => {
          const ActivityIcon = item.icon;
          return (
            <li className={`activity__item activity__item--${item.tone}`} key={item.label}>
              <span className="activity__icon" aria-hidden="true">
                <ActivityIcon size={21} weight="duotone" />
              </span>
              <span className="activity__copy">
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
              <time dateTime={`2026-08-14T09:4${index}:00+03:30`}>Phase 1 record</time>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
