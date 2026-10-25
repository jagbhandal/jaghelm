/*
 * ConfigDrift (#674): the "Config drift" row, in the Overview's section style
 * and as the phone Overview's list section. The shell judges the hosts' reports
 * (src/shell/drift.js driftView); this only draws the result.
 *
 * `view` is { state: 'none'|'ok'|'drift'|'error'|'unknown', label, detail,
 * hosts: [{ host, status, word, ageText, old, items: [{ name, kind, detail }] }] }.
 * The row is one button that opens the per-host list (a host's drift items under
 * its name, its report's age beside it). The state is always said in words and an
 * icon, never by colour alone; grey is "No reports", never green.
 */
import { useId, useState } from 'react';
import { ChevronRight, CircleCheck, FileDiff, SignalZero, TriangleAlert } from 'lucide-react';
import { ShellSection } from './app-shell.jsx';
import { cn } from './lib/utils.js';

const LOOK = {
  ok: { Icon: CircleCheck, tone: 'text-ok-fg' },
  drift: { Icon: TriangleAlert, tone: 'text-warn-fg' },
  error: { Icon: TriangleAlert, tone: 'text-warn-fg' },
  unknown: { Icon: SignalZero, tone: 'text-warn-fg' },
  none: { Icon: SignalZero, tone: 'text-text-2' },
};

function Hosts({ hosts }) {
  return (
    <ul
      data-slot="config-drift-hosts"
      className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-1"
    >
      {hosts.map((h) => (
        <li key={h.host} data-host={h.host} className="min-w-0 px-panel py-2.5">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span className="font-mono text-body-sm text-text-1">{h.host}</span>
            <span
              className={cn(
                'text-body-sm',
                h.status === 'ok' ? 'text-text-2' : 'text-warn-fg'
              )}
            >
              {h.word}
              {h.items.length > 0 && ` (${h.items.length})`}
            </span>
            <span className="text-caption text-text-3" data-slot="config-drift-age">
              {h.old ? `Last reported ${h.ageText}` : `Reported ${h.ageText}`}
            </span>
          </div>
          {h.items.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-1">
              {h.items.map((i, n) => (
                <li key={`${n}-${i.name}`} className="min-w-0 text-body-sm">
                  <span className="mr-2 font-mono text-caption text-text-3">{i.kind}</span>
                  <span className="break-all font-mono text-text-1">{i.name}</span>
                  {i.detail && <span className="ml-2 text-text-3">{i.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

function Row({ view }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const { Icon, tone } = LOOK[view.state] ?? LOOK.none;
  const can = view.hosts.length > 0;
  const inner = (
    <>
      <Icon aria-hidden="true" className={cn('size-4 shrink-0', tone)} />
      <span className={cn('text-body-sm', tone)} data-slot="config-drift-state" data-state={view.state}>
        {view.label}
      </span>
      <span className="min-w-0 truncate text-body-sm text-text-3">{view.detail}</span>
      {can && (
        <ChevronRight
          aria-hidden="true"
          className={cn('ml-auto size-4 shrink-0 text-text-3 transition-transform', open && 'rotate-90')}
        />
      )}
    </>
  );
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {can ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-surface-1 px-panel py-2.5 text-left"
        >
          {inner}
        </button>
      ) : (
        <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-surface-1 px-panel py-2.5">
          {inner}
        </div>
      )}
      <div id={listId} hidden={!open}>
        {open && <Hosts hosts={view.hosts} />}
      </div>
    </div>
  );
}

function ConfigDrift({ view, phone = false, margin = 16, className }) {
  const id = useId();
  if (phone) {
    return (
      <section
        data-slot="config-drift"
        aria-labelledby={id}
        className={cn('flex min-w-0 flex-col gap-2 text-text-1', className)}
      >
        <h2 id={id} className="text-overline text-text-3 uppercase">
          Config drift
        </h2>
        <Row view={view} />
      </section>
    );
  }
  return (
    // 24px under the section above, lined up with the others (`margin`).
    <div data-slot="overview-config-drift" style={{ margin: `24px ${margin}px 0` }}>
      <ShellSection>
        <section
          data-slot="config-drift"
          aria-labelledby={id}
          className={cn('flex min-w-0 flex-col gap-3 text-text-1', className)}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span
              aria-hidden="true"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-tint text-accent-text inset-ring inset-ring-accent-border [&_svg]:size-4 [&_svg]:stroke-[1.75]"
            >
              <FileDiff />
            </span>
            <h2 id={id} className="text-title-sm">
              Config drift
            </h2>
          </div>
          <Row view={view} />
        </section>
      </ShellSection>
    </div>
  );
}

export { ConfigDrift };
