/*
 * HostActions (#673): the pending host steps, the open rows of the running list
 * in Gitea, in the Overview's section style (JobsSection's heading and panel) and
 * as a phone screen's list section (JobsList's). The shell reads the list and
 * decides what is drawn; this only draws it.
 *
 * `view` is { kind: 'list', count, rows: [{ key, ref, title, href }], more, href,
 * stale } or { kind: 'unreadable', href }. A row is one link out to its PR or
 * issue (a new tab, no opener): its reference in mono, then its words cut to
 * one line. `limit` shows that many rows and counts the rest into "+ N more in
 * #848"; `phone` draws the overline heading and count of a phone's list section
 * instead of the icon chip and title. A list that could not be read is one
 * quiet line with the link to #848, never a count.
 */
import { useId } from 'react';
import { ClipboardList, ExternalLink } from 'lucide-react';
import { ShellSection } from './app-shell.jsx';
import { cn } from './lib/utils.js';

const LINK =
  'inline-flex min-w-0 items-center gap-1 text-accent-text underline-offset-2 hover:underline focus-visible:underline';

function Rows({ view, limit }) {
  const rows = limit ? view.rows.slice(0, limit) : view.rows;
  const more = view.more + (view.rows.length - rows.length);
  return (
    <ul
      data-slot="host-actions-list"
      className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-1"
    >
      {rows.map((row) => (
        <li key={row.key} className="min-w-0 px-panel py-2.5">
          <a
            href={row.href ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3"
          >
            {row.ref && (
              <span className="shrink-0 font-mono text-body-sm text-text-1">{row.ref}</span>
            )}
            {row.ref && ' '}
            <span className="min-w-0 truncate text-body-sm text-text-2">{row.title}</span>
          </a>
        </li>
      ))}
      {(more > 0 || view.stale) && (
        <li className="flex flex-wrap items-center gap-x-3 px-panel py-2.5 text-body-sm text-text-3">
          {more > 0 && (
            <a
              href={view.href ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className={LINK}
            >
              + {more} more in #848 <ExternalLink aria-hidden="true" className="size-3" />
            </a>
          )}
          {view.stale && <span>Last known: Gitea isn't answering</span>}
        </li>
      )}
    </ul>
  );
}

function Unreadable({ view }) {
  return (
    <p
      data-slot="host-actions-unreadable"
      className="rounded-xl border border-border bg-surface-1 px-panel py-2.5 text-body-sm text-text-3"
    >
      Pending host steps: couldn't read the list.{' '}
      <a href={view.href ?? undefined} target="_blank" rel="noopener noreferrer" className={LINK}>
        See #848 <ExternalLink aria-hidden="true" className="size-3" />
      </a>
    </p>
  );
}

function HostActions({ view, phone = false, limit = 0, margin = 16, className }) {
  const id = useId();
  const body =
    view.kind === 'list' ? <Rows view={view} limit={limit} /> : <Unreadable view={view} />;
  const count = view.kind === 'list' ? String(view.count) : null;
  if (phone) {
    return (
      <section
        data-slot="host-actions"
        aria-labelledby={id}
        className={cn('flex min-w-0 flex-col gap-2 text-text-1', className)}
      >
        <div className="flex items-baseline justify-between gap-2">
          <h2 id={id} className="text-overline text-text-3 uppercase">
            Pending host steps
          </h2>
          {count && <span className="text-caption text-text-3">{count}</span>}
        </div>
        {body}
      </section>
    );
  }
  return (
    // 24px under the section above, lined up with the others (`margin`).
    <div data-slot="overview-host-actions" style={{ margin: `24px ${margin}px 0` }}>
      <ShellSection>
        <section
          data-slot="host-actions"
          aria-labelledby={id}
          className={cn('flex min-w-0 flex-col gap-3 text-text-1', className)}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span
              aria-hidden="true"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-tint text-accent-text inset-ring inset-ring-accent-border [&_svg]:size-4 [&_svg]:stroke-[1.75]"
            >
              <ClipboardList />
            </span>
            <div className="flex min-w-min flex-1 flex-wrap items-baseline gap-x-3">
              <h2 id={id} className="text-title-sm">
                Pending host steps
              </h2>
              {count && <span className="text-body-sm text-text-3">{count}</span>}
            </div>
          </div>
          {body}
        </section>
      </ShellSection>
    </div>
  );
}

export { HostActions };
