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
 *    metric or the model's reason as the detail, and the latency as the meta;
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
 * name, where, state, word, detail, meta, muted, href?, onOpen? }`. While `loading`, four
 * placeholder rows stand in, and the section says it is loading.
 *
 * On the Services page (#313): `toolbar` (its filters, ListFilters) goes
 * under the heading row; `empty` (an EmptyState: no service matches the
 * filters) stands in for the panel when no group has a row; and with
 * `onViewChange`, a second SegmentedControl, "Service view" (List, Table),
 * after the grouping. The table (Table, its hidden caption "Services") has
 * the same rows in the groups' order: service (a link that opens it, as a
 * row does, carrying its anchor), node, the custom group while grouped by
 * one, its Docker name (mono `text-3`), the detail (`text-2` while up, else
 * in its state's word colour), latency and state (StateCell, as the
 * Infrastructure table's). Rows also carry `nodeName` and `containerName`
 * for it. It needs
 * 720px, as Infrastructure's: in a narrower section the list stands in and
 * the toggle goes, the choice standing for when it fits again.
 */
import { useId, useRef } from 'react';
import { Activity, List, Rows3 } from 'lucide-react';
import { EntityRow } from './entity-row.jsx';
import { SegmentedControl } from './segmented-control.jsx';
import { Skeleton } from './skeleton.jsx';
import { Table } from './table.jsx';
import { cn } from './lib/utils.js';
import { openHere } from './lib/link.js';
import { StateCell } from './lib/state-cell.jsx';
import { useWidth } from './lib/width.js';

/** The table's least width: narrower, the section draws the list. */
const TABLE_WIDTH = 720;

const VIEWS = [
  { value: 'list', label: 'List', icon: List },
  { value: 'table', label: 'Table', icon: Rows3 },
];

// A failing row's detail in its state's word colour; a healthy one quiet.
const DETAIL_COLOUR = {
  ok: 'text-text-2',
  warn: 'text-warn-fg',
  crit: 'text-crit-fg',
  unknown: 'text-unknown-fg',
  maintenance: 'text-maintenance-fg',
};

const dash = <span className="text-text-3">—</span>;

/** The table's columns; the custom group's only while the rows are grouped by one. */
function columnsFor(byGroup) {
  return [
    {
      key: 'name',
      header: 'Service',
      cell: (row) =>
        row.href ? (
          <a
            id={row.anchor}
            data-entity={row.id}
            href={row.href}
            onClick={row.onOpen ? (e) => openHere(e, row.onOpen) : undefined}
            className="rounded-xs hover:underline"
          >
            {row.name}
          </a>
        ) : (
          <span id={row.anchor} data-entity={row.id}>
            {row.name}
          </span>
        ),
    },
    {
      key: 'node',
      header: 'Node',
      className: 'text-text-2',
      cell: (row) => row.nodeName || row.where || dash,
    },
    ...(byGroup
      ? [
          {
            key: 'group',
            header: 'Group',
            className: 'text-text-2',
            cell: (row) => row.group || dash,
          },
        ]
      : []),
    {
      key: 'docker',
      header: 'Container',
      cell: (row) =>
        row.containerName ? (
          <span className="font-mono text-caption text-text-3">{row.containerName}</span>
        ) : (
          dash
        ),
    },
    {
      key: 'detail',
      header: 'Detail',
      // A long reason ends in an ellipsis, whole in its title, so the table keeps its width.
      cell: (row) =>
        row.detail ? (
          <span
            title={row.detail}
            className={cn(
              'block max-w-72 truncate',
              DETAIL_COLOUR[row.state] ?? DETAIL_COLOUR.unknown
            )}
          >
            {row.detail}
          </span>
        ) : (
          dash
        ),
    },
    { key: 'meta', header: 'Latency', numeric: true, cell: (row) => row.meta || dash },
    {
      key: 'state',
      header: 'State',
      cell: (row) => <StateCell state={row.state} word={row.word} />,
    },
  ];
}

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

function Group({ group }) {
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
  const table = Boolean(onViewChange) && view === 'table' && !narrow;
  const none = groups.every((g) => g.rows.length === 0);
  return (
    <section
      ref={ref}
      data-slot="services-section"
      data-grouping={grouping}
      data-view={table ? 'table' : 'list'}
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
        {onViewChange && !narrow && (
          <SegmentedControl
            aria-label="Service view"
            options={VIEWS}
            value={table ? 'table' : 'list'}
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
      ) : table ? (
        <Table
          caption="Services"
          columns={columnsFor(grouping === 'group')}
          rows={groups.flatMap((g) => g.rows.map((row) => ({ ...row, group: g.title })))}
          minWidth={TABLE_WIDTH}
        />
      ) : (
        <div
          data-slot="services-list"
          className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-1"
        >
          {groups.map((group) => (
            <Group key={group.key} group={group} />
          ))}
        </div>
      )}
    </section>
  );
}

export { ServicesSection };
