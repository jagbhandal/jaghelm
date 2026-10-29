/*
 * "Drive health" (#728, Settings → Notifications; design docs/superpowers/specs/
 * 2026-10-29-drive-health-design.md §7): whether JagHelm judges drives from
 * smartctl_exporter, as a Switch beside what it does. The switch is the
 * server's, not a setting JagHelm stores: JAGHELM_DRIVES in .env decides
 * (`off` turns it off even where the series exist), so here it only shows
 * what is in force and is never changeable; the words say where to change it
 * (a locked toggle is a disabled one, as the Switch draws it).
 *
 * `state`: 'on' (drive data is being read), or 'off' (JAGHELM_DRIVES=off). A
 * server with no drive data at all has nothing to switch, and the page
 * draws none of this (Notifications.jsx).
 */
import { useId } from 'react';
import { Panel } from './panel.jsx';
import { Switch } from './switch.jsx';

const WORDS = {
  on: {
    title: 'On',
    body: 'JagHelm reads each node’s drives from smartctl_exporter, judges them (health check, sector and media-error growth, spare, temperature) and alerts as for any other node reading.',
  },
  off: {
    title: 'Off',
    body: 'JagHelm ignores drive data. The drives, their lines on the temperature chart and their alerts are gone from every node.',
  },
};

function DriveHealthSetting({ state = 'on', title = 'Drive health', className, ...props }) {
  const id = useId();
  const on = state !== 'off';
  const words = WORDS[on ? 'on' : 'off'];
  return (
    <Panel
      flush
      title={title}
      description="Judge each node’s drives (SMART) and alert on them."
      className={className}
      data-state={on ? 'on' : 'off'}
      {...props}
    >
      <div data-slot="drive-health" className="flex items-start gap-3 px-panel py-3">
        <Switch
          checked={on}
          disabled
          aria-label="Drive health"
          aria-describedby={`${id}-why ${id}-set`}
          className="mt-0.5"
        />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-body font-semibold text-text-1">{words.title}</p>
          <p id={`${id}-why`} className="text-body-sm text-text-2">
            {words.body}
          </p>
          <p id={`${id}-set`} className="text-body-sm text-text-3">
            Set by <code className="font-mono">JAGHELM_DRIVES</code> in JagHelm’s .env on the host
            {on ? '' : ' (off)'}: change it there and run docker compose up -d again.
          </p>
        </div>
      </div>
    </Panel>
  );
}

export { DriveHealthSetting };
