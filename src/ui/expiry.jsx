/*
 * Expiry (#676): the TLS certificates and Tailscale node keys being tracked,
 * soonest first, in the Overview's section style (HostActions' heading and
 * panel) and as a phone screen's list section. The shell reads the server and
 * judges the days against Settings' lines (src/shell/expiry.js); this only
 * draws what it is given.
 *
 * `view` is { rows: [{ key, name, detail, source, state, text, said }],
 * noExpiry: { count, names } | null, notices: [{ key, text }], offline: [{ key,
 * text }] (muted lines), tracked }.
 * A row's state is ok, warn, crit, unknown or checking, and is drawn as an icon
 * and its words ("5 days left", "Unreachable"), the colour on top of them,
 * never alone; `said` is the whole sentence for a screen reader. `limit` shows
 * that many rows with a button for the rest; `phone` draws the overline heading
 * of a phone's list section instead of the icon chip and title.
 */
import { useId, useState } from 'react';
import {
  CalendarClock,
  CircleCheck,
  CircleQuestionMark,
  Hourglass,
  OctagonAlert,
  TriangleAlert,
} from 'lucide-react';
import { ShellSection } from './app-shell.jsx';
import { Button } from './button.jsx';
import { cn } from './lib/utils.js';

const ICON = {
  ok: CircleCheck,
  warn: TriangleAlert,
  crit: OctagonAlert,
  unknown: CircleQuestionMark,
  checking: Hourglass,
};
const WORDS = {
  ok: 'text-text-1',
  warn: 'text-warn-fg',
  crit: 'text-crit-fg',
  unknown: 'text-text-2',
  checking: 'text-text-3',
};

function Rows({ view, limit }) {
  const [all, setAll] = useState(false);
  const rows = limit && !all ? view.rows.slice(0, limit) : view.rows;
  const hidden = view.rows.length - rows.length;
  const { noExpiry } = view;
  return (
    <ul
      data-slot="expiry-list"
      className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-1"
    >
      {view.notices.map((n) => (
        <li
          key={n.key}
          data-slot="expiry-notice"
          className="flex items-start gap-2 px-panel py-2.5 text-body-sm text-warn-fg"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0">{n.text}</span>
        </li>
      ))}
      {rows.map((row) => {
        const Icon = ICON[row.state] ?? CircleQuestionMark;
        return (
          <li
            key={row.key}
            data-slot="expiry-row"
            data-state={row.state}
            className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-panel py-2.5"
          >
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span className="min-w-0 truncate font-mono text-body-sm text-text-1">{row.name}</span>
              <span className="shrink-0 text-caption text-text-3">
                {row.source}
                {row.detail && row.source === 'TLS' ? ` · ${row.detail}` : ''}
              </span>
            </span>
            <span
              className={cn('flex shrink-0 items-center gap-1 text-body-sm', WORDS[row.state])}
            >
              <Icon aria-hidden="true" className="size-3.5 shrink-0" />
              <span aria-hidden="true">{row.text}</span>
              <span className="sr-only">{row.said}</span>
            </span>
          </li>
        );
      })}
      {rows.length === 0 && view.notices.length === 0 && view.offline.length === 0 && !noExpiry && (
        <li className="px-panel py-2.5 text-body-sm text-text-3">Nothing to track yet.</li>
      )}
      {view.offline.map((o) => (
        <li key={o.key} data-slot="expiry-offline" className="px-panel py-2.5 text-body-sm text-text-3">
          {o.text}
        </li>
      ))}
      {noExpiry && (
        <li
          data-slot="expiry-no-expiry"
          title={noExpiry.names.join(', ')}
          className="px-panel py-2.5 text-body-sm text-text-3"
        >
          {noExpiry.count} Tailscale {noExpiry.count === 1 ? 'device has' : 'devices have'} key
          expiry off, so nothing to track.
        </li>
      )}
      {limit > 0 && view.rows.length > limit && (
        <li className="px-panel py-1.5">
          <Button
            variant="ghost"
            size="sm"
            tone="accent"
            onClick={() => setAll(!all)}
            aria-expanded={all}
          >
            {all ? 'Show fewer' : `Show ${hidden} more`}
          </Button>
        </li>
      )}
    </ul>
  );
}

function Expiry({ view, phone = false, limit = 0, margin = 16, className }) {
  const id = useId();
  const count = String(view.tracked);
  const body = <Rows view={view} limit={limit} />;
  if (phone) {
    return (
      <section
        data-slot="expiry"
        aria-labelledby={id}
        className={cn('flex min-w-0 flex-col gap-2 text-text-1', className)}
      >
        <div className="flex items-baseline justify-between gap-2">
          <h2 id={id} className="text-overline text-text-3 uppercase">
            Expiry
          </h2>
          <span className="text-caption text-text-3">{count}</span>
        </div>
        {body}
      </section>
    );
  }
  return (
    // 24px under the section above, lined up with the others (`margin`).
    <div data-slot="overview-expiry" style={{ margin: `24px ${margin}px 0` }}>
      <ShellSection>
        <section
          data-slot="expiry"
          aria-labelledby={id}
          className={cn('flex min-w-0 flex-col gap-3 text-text-1', className)}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span
              aria-hidden="true"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-tint text-accent-text inset-ring inset-ring-accent-border [&_svg]:size-4 [&_svg]:stroke-[1.75]"
            >
              <CalendarClock />
            </span>
            <div className="flex min-w-min flex-1 flex-wrap items-baseline gap-x-3">
              <h2 id={id} className="text-title-sm">
                Expiry
              </h2>
              <span className="text-body-sm text-text-3">{count} tracked</span>
            </div>
          </div>
          {body}
        </section>
      </ShellSection>
    </div>
  );
}

export { Expiry };
