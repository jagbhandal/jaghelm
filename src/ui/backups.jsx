/*
 * Backups (#675): when each backup last ran well and the B2 bucket's size, in
 * the Overview's section style (JobsSection's heading and panel) and as a phone
 * screen's list section. The shell reads the answer and judges the ages
 * (src/shell/backups.js); this only draws `view`:
 *
 *   { rows: [{ id, name, where, state, word, detail, meta, muted }],
 *     b2: null | { kind: 'pending', name, state, word, detail }
 *            | { kind: 'size', name, state, word, size, detail, hidden, history, folders },
 *     count, state }
 *
 * A job is an EntityRow (lamp, name, node, detail, meta); the bucket is one
 * more row with a sparkline once there is a history, a "hidden versions" line
 * in the warning colour when the old bloat is back, and, under a disclosure,
 * when data last arrived in each folder (a fact, not judged).
 */
import { useId } from 'react';
import { DatabaseBackup } from 'lucide-react';
import { ShellSection } from './app-shell.jsx';
import { EntityRow } from './entity-row.jsx';
import { Sparkline } from './sparkline.jsx';
import { cn } from './lib/utils.js';

function B2Row({ b2 }) {
  const trailing =
    b2.kind === 'size' && b2.history.length >= 2 ? (
      <Sparkline
        decorative
        label={`${b2.name} size, last ${b2.history.length} days`}
        points={b2.history}
        domain="auto"
        width={96}
        height={24}
      />
    ) : undefined;
  return (
    <div data-slot="backups-b2">
      <EntityRow
        data-entity="backup/b2"
        state={b2.state}
        word={b2.word}
        name="B2 bucket"
        where={b2.name}
        detail={b2.detail}
        trailing={trailing}
        muted={b2.state === 'ok'}
      />
      {b2.kind === 'size' && b2.hidden && (
        <p
          data-slot="backups-hidden"
          className={cn(
            'px-panel pb-2 text-body-sm',
            b2.hidden.state === 'warn' ? 'text-warn-fg' : 'text-text-3'
          )}
        >
          {b2.hidden.text}
        </p>
      )}
      {b2.kind === 'size' && b2.folders.length > 0 && (
        <details data-slot="backups-folders" className="px-panel pb-2 text-body-sm text-text-2">
          <summary className="cursor-pointer text-text-3">Last data uploaded, by folder</summary>
          <ul className="mt-1 flex flex-col gap-0.5">
            {b2.folders.map((f) => (
              <li key={f.name} className="flex min-w-0 items-baseline gap-3">
                <span className="min-w-0 truncate font-mono text-text-1">{f.name}</span>
                <span className="ml-auto shrink-0">{f.last}</span>
                <span className="w-16 shrink-0 text-right text-text-3">{f.size}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Panel({ view }) {
  return (
    <ul
      data-slot="backups-list"
      className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-1"
    >
      {view.rows.map((row) => (
        <li key={row.id} className="min-w-0">
          <EntityRow
            data-entity={row.id}
            state={row.state}
            word={row.word}
            name={row.name}
            where={row.where || undefined}
            detail={row.detail ?? undefined}
            meta={row.meta ?? undefined}
            muted={row.muted}
          />
        </li>
      ))}
      {view.b2 && (
        <li className="min-w-0">
          <B2Row b2={view.b2} />
        </li>
      )}
    </ul>
  );
}

function Backups({ view, phone = false, margin = 16, className }) {
  const id = useId();
  if (phone) {
    return (
      <section
        data-slot="backups"
        aria-labelledby={id}
        className={cn('flex min-w-0 flex-col gap-2 text-text-1', className)}
      >
        <div className="flex items-baseline justify-between gap-2">
          <h2 id={id} className="text-overline text-text-3 uppercase">
            Backups
          </h2>
          <span className="text-caption text-text-3">{view.count}</span>
        </div>
        <Panel view={view} />
      </section>
    );
  }
  return (
    // 24px under the section above, lined up with the others (`margin`).
    <div data-slot="overview-backups" style={{ margin: `24px ${margin}px 0` }}>
      <ShellSection>
        <section
          data-slot="backups"
          aria-labelledby={id}
          className={cn('flex min-w-0 flex-col gap-3 text-text-1', className)}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span
              aria-hidden="true"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-tint text-accent-text inset-ring inset-ring-accent-border [&_svg]:size-4 [&_svg]:stroke-[1.75]"
            >
              <DatabaseBackup />
            </span>
            <div className="flex min-w-min flex-1 flex-wrap items-baseline gap-x-3">
              <h2 id={id} className="text-title-sm">
                Backups
              </h2>
              <span className="text-body-sm text-text-3">{view.count}</span>
            </div>
          </div>
          <Panel view={view} />
        </section>
      </ShellSection>
    </div>
  );
}

export { Backups };
