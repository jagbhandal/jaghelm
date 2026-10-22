/*
 * InfrastructureSection (spec §8 item 3; #299): the Overview's nodes, as the
 * mock's Infrastructure section. A heading row: the section's icon in a 32px
 * accent chip, "Infrastructure" (16px bold), the count in 13px text-3
 * ("3 nodes · 1 warning"), under the heading when they don't fit side by
 * side, and at its end the Cards / Table SegmentedControl ("Node view"),
 * which moves to a line of its own when the row runs out of room. Under it an
 * optional `banner` (a Banner saying the readings are old), then the nodes:
 *
 *  - cards: a NodeCard each, in columns at least 260px wide (one to a row on
 *    a phone), the cards of a row as tall as the tallest;
 *  - table: the mock's Infrastructure table (Table, its hidden caption
 *    "Nodes", so its frame, when it scrolls, isn't a second "Infrastructure"
 *    region): node, role, CPU, memory,
 *    disk, temperature, services, state. A reading prints as its meter does
 *    (`shown`), in its state's word colour only at or over its line, with the
 *    state said to screen readers; no reading is a dash. The state is the
 *    lamp and the model's word, the word in text-1 when healthy; a lamp
 *    drawn as no signal beside another word (a stale status's last known
 *    word, #480) is named "No signal" (lampName). It needs
 *    720px: in a section narrower than that (a phone, a tablet), the table
 *    would hide its readings and the state off to the side, so the section
 *    draws the cards instead and offers no toggle; the choice of the table
 *    stands for when it is wide enough again.
 *
 * Each node is `{ id, anchor, name, host, subtitle, colour, state, word,
 * reason, readings, services, uptime, trend }` (NodeCard's props, `services`
 * the hosted services in words); each reading as NodeCard's, plus `shown`,
 * its printed value. `anchor` is the element id a page links to
 * (the card, or the node's name in the table). While `loading`, three
 * placeholder cards stand in, and the section says it is loading.
 */
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { LayoutGrid, Rows3, Server } from 'lucide-react';
import { NodeCard, NodeSwatch } from './node-card.jsx';
import { SegmentedControl } from './segmented-control.jsx';
import { Skeleton } from './skeleton.jsx';
import { StatusLamp } from './status-lamp.jsx';
import { StatusWord } from './status-word.jsx';
import { Table } from './table.jsx';
import { cn } from './lib/utils.js';
import { WORDS, lampName, toState } from './lib/status.js';

/** The table's least width: narrower, the section draws cards. */
const TABLE_WIDTH = 720;

/** Its own width, measured as it resizes; null until it has one (no layout, as in a test). */
function useWidth(ref) {
  const [width, setWidth] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      setWidth(w > 0 ? w : null);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

const VIEWS = [
  { value: 'cards', label: 'Cards', icon: LayoutGrid },
  { value: 'table', label: 'Table', icon: Rows3 },
];

// A reading at or over its line, in its state's word colour.
const loud = { warn: 'font-semibold text-warn-fg', crit: 'font-semibold text-crit-fg' };
const SAID = { warn: 'warning', crit: 'critical' };

function Reading({ reading }) {
  if (!reading) return <span className="text-text-3">—</span>;
  if (reading.shown == null) {
    return (
      <span>
        <span aria-hidden="true" className="text-unknown-fg">
          —
        </span>
        <span className="sr-only">No data</span>
      </span>
    );
  }
  const level = Object.hasOwn(loud, reading.state) ? reading.state : null;
  return (
    <span data-state={reading.state ?? undefined} className={level ? loud[level] : undefined}>
      {reading.shown}
      {level && <span className="sr-only">, {SAID[level]}</span>}
    </span>
  );
}

const readingColumn = (key, header) => ({
  key,
  header,
  numeric: true,
  cell: (node) => <Reading reading={node.readings.find((r) => r.key === key)} />,
});

const COLUMNS = [
  {
    key: 'name',
    header: 'Node',
    cell: (node) => (
      <span id={node.anchor} className="inline-flex items-center gap-2">
        <NodeSwatch colour={node.colour} />
        {node.name}
        {node.host && (
          <span className="font-mono text-caption font-normal text-text-3">{node.host}</span>
        )}
      </span>
    ),
  },
  { key: 'subtitle', header: 'Role', className: 'text-text-2' },
  readingColumn('cpu', 'CPU'),
  readingColumn('mem', 'Memory'),
  readingColumn('disk', 'Disk'),
  readingColumn('temp', 'Temp'),
  { key: 'services', header: 'Services', className: 'text-text-2' },
  {
    key: 'state',
    header: 'State',
    cell: (node) => {
      const s = toState(node.state);
      const word = node.word || WORDS[s];
      const named = lampName(s, word);
      // Healthy stays quiet: its lamp, and the word in the row's own colour.
      return (
        <span className="inline-flex items-center gap-2">
          <StatusLamp state={s} label={named} decorative={named === word} />
          {s === 'ok' ? (
            <span className="font-semibold">{word}</span>
          ) : (
            <StatusWord state={s} word={word} className="font-semibold" />
          )}
        </span>
      );
    },
  },
];

function Loading() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
      <span className="sr-only">The nodes are loading</span>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-48 rounded-xl" />
      ))}
    </div>
  );
}

function InfrastructureSection({
  nodes = [],
  count,
  view = 'cards',
  onViewChange,
  loading = false,
  banner,
  title = 'Infrastructure',
  className,
  ...props
}) {
  const id = useId();
  const ref = useRef(null);
  const width = useWidth(ref);
  const narrow = width != null && width < TABLE_WIDTH;
  const table = view === 'table' && !narrow;
  return (
    <section
      ref={ref}
      data-slot="infrastructure-section"
      data-view={table ? 'table' : 'cards'}
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
          <Server />
        </span>
        <div className="flex min-w-min flex-1 flex-wrap items-baseline gap-x-3">
          <h2 id={`${id}-title`} className="text-title-sm">
            {title}
          </h2>
          {count && !loading && <span className="text-body-sm text-text-3">{count}</span>}
        </div>
        {onViewChange && !narrow && (
          <SegmentedControl
            aria-label="Node view"
            options={VIEWS}
            value={table ? 'table' : 'cards'}
            onValueChange={(value) => onViewChange(value)}
            className="ml-auto"
          />
        )}
      </div>
      {banner}
      {loading ? (
        <Loading />
      ) : table ? (
        <Table caption="Nodes" columns={COLUMNS} rows={nodes} minWidth={720} />
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
          {nodes.map((node) => (
            <li key={node.id} className="min-w-0">
              <NodeCard
                id={node.anchor}
                data-node={node.id}
                name={node.name}
                host={node.host}
                subtitle={node.subtitle}
                colour={node.colour}
                state={node.state}
                word={node.word}
                reason={node.reason}
                readings={node.readings}
                services={node.services}
                uptime={node.uptime}
                trend={node.trend}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export { InfrastructureSection };
