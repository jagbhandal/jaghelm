/*
 * JobsSection (#578): the Overview's scheduled jobs and backups, in the
 * mock's section style (its Services section's: the mock draws no jobs list
 * of its own). A heading row: the section's icon (Lucide `CalendarClock`) in
 * a 32px accent chip, "Jobs" (16px bold) and the count in 13px text-3 ("8
 * scheduled · 1 overdue"), under the heading when they don't fit side by
 * side. Under it an optional `banner`, then one panel: `surface-1` in a
 * subtle edge, 12px round, holding the groups, Jobs then Backups. Each
 * group's heading is the Services section's: on `surface-2` above a subtle
 * rule, its title as an overline in text-2 and its count at the end ("3 / 3
 * OK"); then its rows, each an EntityRow, a subtle rule between them:
 *
 *  - lamp, name, `where` (its node, 12px mono text-3), the schedule in words
 *    while it is well, else the model's reason, as the detail, and how long
 *    ago it last reported as the meta;
 *  - a healthy row is muted, a failing one keeps its state's colour (the
 *    status roles: a failed backup critical, its tint too; a failed or
 *    overdue job a warning);
 *  - narrower than 672px (a phone), the Phone board's row: the name over
 *    "detail · meta".
 *
 * A row with an `href` or `onOpen` opens its job (EntityRow's link; the
 * Overview's open its detail, #309) and carries its entity id
 * (`data-entity`). With no group (every job it listed was removed in this
 * tab, the model not yet told), a quiet line says so (`empty`) under the
 * heading, which takes focus from a script (`tabIndex` -1): where focus goes
 * when the last row is removed.
 *
 * `groups` is `[{ key, title, count, rows }]`, each row `{ id, name, where,
 * state, word, detail, meta, muted, href?, onOpen? }`. While `loading`,
 * three placeholder rows stand in, and the section says it is loading.
 * `JobsList` is the same panel under a phone screen's heading (the phone's
 * Infrastructure tab), with no icon chip.
 */
import { useId } from 'react';
import { CalendarClock } from 'lucide-react';
import { EntityRow } from './entity-row.jsx';
import { Skeleton } from './skeleton.jsx';
import { cn } from './lib/utils.js';

function Loading() {
  return (
    <div className="flex flex-col gap-px overflow-hidden rounded-xl border border-border bg-surface-1">
      <span className="sr-only">The jobs are loading</span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex h-row items-center gap-3.5 px-panel">
          <Skeleton className="size-3 rounded-full" />
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-3 flex-1" />
        </div>
      ))}
    </div>
  );
}

function Group({ group }) {
  const id = useId();
  return (
    <div data-slot="jobs-group" data-group={group.key}>
      <div className="flex items-center gap-2.5 border-b border-border bg-surface-2 px-panel pt-2.5 pb-2">
        <h3 id={`${id}-title`} className="min-w-0 text-overline text-text-2 uppercase">
          {group.title}
        </h3>
        {group.count && (
          <span className="ml-auto shrink-0 text-caption text-text-3">{group.count}</span>
        )}
      </div>
      <ul aria-labelledby={`${id}-title`} className="divide-y divide-border">
        {group.rows.map((row) => (
          <li key={row.id} className="min-w-0">
            <EntityRow
              data-entity={row.id}
              state={row.state}
              word={row.word}
              name={row.name}
              where={row.where || undefined}
              detail={row.detail ?? undefined}
              meta={row.meta}
              muted={row.muted}
              href={row.href}
              onOpen={row.onOpen}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

// Every job it listed was removed in this tab, and the model hasn't dropped them yet.
const EMPTY = 'None left to list: a removed job comes back when it reports again.';

function Panel({ groups, empty }) {
  if (groups.length === 0)
    return (
      <p data-slot="jobs-empty" className="text-body-sm text-text-3">
        {empty}
      </p>
    );
  return (
    <div
      data-slot="jobs-list"
      className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-1"
    >
      {groups.map((group) => (
        <Group key={group.key} group={group} />
      ))}
    </div>
  );
}

/**
 * The panel of groups under a phone screen's heading, as the phone's
 * Infrastructure tab heads its nodes: `title` an overline in text-3, `count`
 * in 12px text-3 at its end, 8px over the panel.
 */
function JobsList({ groups = [], title = 'Jobs', count, empty = EMPTY, className, ...props }) {
  const id = useId();
  return (
    <section
      data-slot="jobs-list-section"
      aria-labelledby={`${id}-title`}
      className={cn('flex min-w-0 flex-col gap-2 text-text-1', className)}
      {...props}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2
          id={`${id}-title`}
          data-slot="jobs-title"
          tabIndex={-1}
          className="text-overline text-text-3 uppercase -outline-offset-2"
        >
          {title}
        </h2>
        {count && <span className="text-caption text-text-3">{count}</span>}
      </div>
      <Panel groups={groups} empty={empty} />
    </section>
  );
}

function JobsSection({
  groups = [],
  count,
  loading = false,
  banner,
  title = 'Jobs',
  empty = EMPTY,
  className,
  ...props
}) {
  const id = useId();
  return (
    <section
      data-slot="jobs-section"
      aria-labelledby={`${id}-title`}
      aria-busy={loading || undefined}
      className={cn('flex min-w-0 flex-col gap-3 text-text-1', className)}
      {...props}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span
          aria-hidden="true"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-tint text-accent-text inset-ring inset-ring-accent-border [&_svg]:size-4 [&_svg]:stroke-[1.75]"
        >
          <CalendarClock />
        </span>
        <div className="flex min-w-min flex-1 flex-wrap items-baseline gap-x-3">
          <h2
            id={`${id}-title`}
            data-slot="jobs-title"
            tabIndex={-1}
            className="text-title-sm -outline-offset-2"
          >
            {title}
          </h2>
          {count && !loading && <span className="text-body-sm text-text-3">{count}</span>}
        </div>
      </div>
      {banner}
      {loading ? <Loading /> : <Panel groups={groups} empty={empty} />}
    </section>
  );
}

export { JobsList, JobsSection };
