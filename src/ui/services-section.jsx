/*
 * ServicesSection (spec §8 item 4; #300): the Overview's services, as the
 * mock's Services section. A heading row: the section's icon (Lucide
 * `Activity`, the mock's) in a 32px accent chip, "Services" (16px bold), the
 * count in 13px text-3 ("12 monitored · 1 down"), under the heading when they
 * don't fit side by side, and at its end the grouping, a SegmentedControl
 * named "Group services by" (Node, Group), when it can be changed. A way with nothing in it yet is a disabled segment, and
 * `groupingHint` (a caption under the control, which describes it) says where
 * to set it up. Under it an optional `banner` (a Banner saying the readings
 * are old), then one panel: `surface-1` in a subtle edge, 12px round, holding
 * the groups. Each group's heading is the mock's: on `surface-2` above a
 * subtle rule, its title as an overline in text-2, the node's key in 12px mono
 * text-3 beside it, and its count ("7 / 8 up") at the end; then its rows,
 * each an EntityRow, a subtle rule between them:
 *
 *  - lamp, name, `where` (the node, when the group isn't one), the headline
 *    metric or the model's reason as the detail, the latency as the meta,
 *    and a monitored service's heartbeat strip as the trailing figure (#312:
 *    its last 30 checks, UptimeBar, each with its time and response time
 *    under the pointer). A row with no monitor draws no strip; while another
 *    row has one, it keeps a strip's room, empty (BeatSpace), so the meta
 *    and the strips line up down the list. The strip follows EntityRow's
 *    rule: from 672px it takes the room the name, detail and meta leave, up
 *    to its 178px, losing its oldest beats first; narrower, the newest 12;
 *  - a healthy row is muted (its detail in text-2), a failing one keeps its
 *    state's colour and, critical, its tint;
 *  - the name is never cut short before anything else (EntityRow's rule);
 *  - narrower than 672px (a phone), the Phone board's row: the name over the
 *    detail, no meta.
 *
 * A row's lamp drawn as no signal beside its last known word (a stale
 * status, #480) is named "No signal" (EntityRow, lampName). A row with an
 * `href` or `onOpen` opens its service (EntityRow's link; the Overview's
 * open its detail, #309); each carries its anchor (`id`), so a page can link
 * to it and focus it.
 *
 * `groups` is `[{ key, title, host, count, rows }]`, each row `{ id, anchor,
 * name, where, state, word, detail, meta, muted, beats?, stale?, stack?, href?,
 * onOpen? }` (`stale`: the strip draws no level colour). While `loading`, four
 * placeholder rows stand in, and the section says it is loading.
 *
 * `showAll` (`{ href, label, onOpen? }`, the Overview's, #313): a link at the
 * panel's foot, as the mock's "Show all 32 services →", 13px semibold in
 * accent-text, 12px over the panel's padding, under a subtle rule; a plain
 * click opens it in the page with `onOpen` (lib/link.js).
 *
 * On the Services page (#313): `toolbar` (its filters, ListFilters) goes
 * under the heading row; `empty` (an EmptyState: no service matches the
 * filters) stands in for the panel when no group has a row; and with
 * `onViewChange` and a `table` (ServicesTable, services-table.jsx, a module
 * of its own that only the page loads), a second SegmentedControl, "Service
 * view" (List, Table), after the grouping, and the table in the panel's
 * place. It needs 800px (Infrastructure's 720 and the heartbeat strip's
 * newest 12, #312): in a narrower section the list stands in and the toggle
 * goes, the choice standing for when it fits again.
 */
import { useId, useRef } from 'react';
import { Activity, List, Rows3 } from 'lucide-react';
import { EntityRow } from './entity-row.jsx';
import { BeatSpace, StripWithNote, UptimeBar } from './uptime-bar.jsx';
import { SegmentedControl } from './segmented-control.jsx';
import { Skeleton } from './skeleton.jsx';
import { cn } from './lib/utils.js';
import { openHere } from './lib/link.js';
import { useWidth } from './lib/width.js';

/** The table's least width (services-table.jsx's): narrower, the section draws the list. */
const TABLE_WIDTH = 800;

/** How many checks a row's strip shows: the mock's 30. */
const ROW_BEATS = 30;

const VIEWS = [
  { value: 'list', label: 'List', icon: List },
  { value: 'table', label: 'Table', icon: Rows3 },
];

function Loading() {
  return (
    <div className="flex flex-col gap-px overflow-hidden rounded-xl border border-border bg-surface-1">
      <span className="sr-only">The services are loading</span>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex h-row items-center gap-3.5 px-panel">
          <Skeleton className="size-3 rounded-full" />
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-3 flex-1" />
        </div>
      ))}
    </div>
  );
}

/** A row's trailing figure: its strip, else a strip's room while other rows have one. */
function trailingOf(row, room) {
  if (row.beats) {
    return (
      <StripWithNote history={row.beatsHistory}>
        <UptimeBar
          beats={row.beats}
          count={ROW_BEATS}
          stale={row.stale}
          history={row.beatsHistory}
        />
      </StripWithNote>
    );
  }
  return room ? <BeatSpace count={ROW_BEATS} /> : undefined;
}

function Group({ group, room = false }) {
  const id = useId();
  return (
    <div data-slot="services-group" data-group={group.key}>
      <div className="flex items-center gap-2.5 border-b border-border bg-surface-2 px-panel pt-2.5 pb-2">
        <h3 id={`${id}-title`} className="min-w-0 text-overline text-text-2 uppercase">
          {group.title}
        </h3>
        {group.host && (
          <span className="min-w-0 truncate font-mono text-caption text-text-3">{group.host}</span>
        )}
        {group.count && (
          <span className="ml-auto shrink-0 text-caption text-text-3">{group.count}</span>
        )}
      </div>
      <ul aria-labelledby={`${id}-title`} className="divide-y divide-border">
        {group.rows.map((row) => (
          <li key={row.id} className="min-w-0">
            <EntityRow
              id={row.anchor}
              data-entity={row.id}
              state={row.state}
              word={row.word}
              name={row.name}
              where={row.where ?? undefined}
              detail={row.detail ?? undefined}
              meta={row.meta}
              trailing={trailingOf(row, room)}
              stack={row.stack}
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

function ServicesSection({
  groups = [],
  count,
  grouping = 'node',
  groupings = [],
  onGroupingChange,
  groupingHint,
  view = 'list',
  onViewChange,
  table,
  showAll,
  loading = false,
  banner,
  toolbar,
  empty,
  title = 'Services',
  className,
  ...props
}) {
  const id = useId();
  const ref = useRef(null);
  const width = useWidth(ref);
  const narrow = width != null && width < TABLE_WIDTH;
  const tables = Boolean(onViewChange && table);
  const asTable = tables && view === 'table' && !narrow;
  const none = groups.every((g) => g.rows.length === 0);
  // Whether any row has a strip: rows without one then keep its room.
  const room = groups.some((g) => g.rows.some((r) => Array.isArray(r.beats)));
  return (
    <section
      ref={ref}
      data-slot="services-section"
      data-grouping={grouping}
      data-view={asTable ? 'table' : 'list'}
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
          <Activity />
        </span>
        <div className="flex min-w-min flex-1 flex-wrap items-baseline gap-x-3">
          <h2 id={`${id}-title`} className="text-title-sm">
            {title}
          </h2>
          {count && !loading && <span className="text-body-sm text-text-3">{count}</span>}
        </div>
        {onGroupingChange && groupings.length > 0 && (
          <div className="ml-auto flex flex-col items-end gap-1">
            <SegmentedControl
              aria-label="Group services by"
              aria-describedby={groupingHint ? `${id}-hint` : undefined}
              options={groupings}
              value={grouping}
              onValueChange={(value) => onGroupingChange(value)}
            />
            {groupingHint && (
              <p
                id={`${id}-hint`}
                data-slot="services-grouping-hint"
                className="text-right text-caption text-text-3 [&_a]:font-semibold [&_a]:text-accent-text [&_a]:hover:underline"
              >
                {groupingHint}
              </p>
            )}
          </div>
        )}
        {tables && !narrow && (
          <SegmentedControl
            aria-label="Service view"
            options={VIEWS}
            value={asTable ? 'table' : 'list'}
            onValueChange={(value) => onViewChange(value)}
            className={cn('self-start', !(onGroupingChange && groupings.length > 0) && 'ml-auto')}
          />
        )}
      </div>
      {toolbar}
      {banner}
      {loading ? (
        <Loading />
      ) : none && empty ? (
        empty
      ) : asTable ? (
        table
      ) : (
        <div
          data-slot="services-list"
          className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-1"
        >
          {groups.map((group) => (
            <Group key={group.key} group={group} room={room} />
          ))}
          {showAll && (
            <div data-slot="services-show-all" className="px-panel py-3 text-body-sm">
              <a
                href={showAll.href}
                onClick={showAll.onOpen ? (e) => openHere(e, showAll.onOpen) : undefined}
                className="rounded-xs font-semibold text-accent-text hover:underline"
              >
                {showAll.label}
                <span aria-hidden="true"> →</span>
              </a>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export { ServicesSection };
