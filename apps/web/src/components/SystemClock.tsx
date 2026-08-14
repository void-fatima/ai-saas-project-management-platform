import { useEffect, useState } from 'react';

import { ClockIcon } from './icons';

const tehranTimeZone = 'Asia/Tehran';

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  hour12: false,
  minute: '2-digit',
  second: '2-digit',
  timeZone: tehranTimeZone,
});

const offsetFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: tehranTimeZone,
  timeZoneName: 'longOffset',
});

function formatOffset(date: Date): string {
  const offset = offsetFormatter
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')?.value;

  return (offset ?? 'GMT+03:30').replace('GMT', 'UTC');
}

export function SystemClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const time = timeFormatter.format(now);

  return (
    <div className="system-clock" role="timer" aria-label={`Current time in Tehran: ${time}`}>
      <ClockIcon aria-hidden="true" size={17} />
      <span>
        <time dateTime={now.toISOString()}>{time}</time>
        <small>Tehran · {formatOffset(now)}</small>
      </span>
    </div>
  );
}
