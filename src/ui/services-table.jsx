/*
 * ServicesTable (#313): the Services page's table, a module of its own so
 * only the page's chunk carries it (ServicesSection draws it in the panel's
 * place, `table`). The Table component, its hidden caption "Services": the
 * rows of `groups` in their order, each a row: service (semibold, a link
 * that opens it, as a list row does, carrying its anchor), node in `text-2`,
 * the custom group while `grouping` is by one, its Docker name in 12px mono
 * `text-3`, the detail (`text-2` while up, else its state's word colour,
 * ending in an ellipsis past 288px, whole in its title), the latency,
 * right-aligned, a monitored service's heartbeat strip (#312: its last 30
 * checks, losing its oldest down to 12 before the table would scroll; a
 * dash with no monitor), and the state
 * (StateCell, as the Infrastructure table's).
 * Rows carry `nodeName` and `containerName` for it. It is 720px at least,
 * scrolling inside its frame when narrower; the section draws it from 800px
 * of its own (the strip's newest 12 beside the mock's 720, #312), the list
 * below that.
 */
import { Table } from './table.jsx';
import { cn } from './lib/utils.js';
import { openHere } from './lib/link.js';
import { StateCell } from './lib/state-cell.jsx';
import { UptimeBar } from './uptime-bar.jsx';

const MIN_WIDTH = 720;

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
      key: 'beats',
      header: 'Heartbeats',
      // Narrowed before the table would scroll: it loses its oldest beats,
      // down to the newest 12, as a row's strip does.
      cell: (row) =>
        row.beats ? <UptimeBar beats={row.beats} count={30} stale={row.stale} fit /> : dash,
    },
    {
      key: 'state',
      header: 'State',
      cell: (row) => <StateCell state={row.state} word={row.word} />,
    },
  ];
}

function ServicesTable({ groups = [], grouping = 'node', ...props }) {
  return (
    <Table
      caption="Services"
      columns={columnsFor(grouping === 'group')}
      rows={groups.flatMap((g) => g.rows.map((row) => ({ ...row, group: g.title })))}
      minWidth={MIN_WIDTH}
      {...props}
    />
  );
}

export { ServicesTable };
