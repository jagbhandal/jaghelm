/*
 * DetailDrives (drive health, #728; design docs/superpowers/specs/
 * 2026-10-29-drive-health-design.md §8): a node's drives in its detail, the
 * desktop's drawer and the phone's sheet, directly under the status box (the
 * mock's placement A). A "Drives" heading (DetailSection's overline) with a
 * count at its end in the worst state's word colour ("3 · 1 failing"), then
 * one panel of rows (`rounded-xl border border-border bg-surface-2`): each a
 * lamp (the drive's state, named by it, or decorative beside its word), the
 * drive's name in mono, its word when it isn't healthy, its temperature at
 * the end, and under them a line of text-2 (the model, then a few words:
 * "ST8000VN004 · no bad sectors", "· failed its health check"). Healthy
 * stays quiet: a small lamp and plain text.
 *
 * A row with details is a disclosure button: Enter or Space (or a tap) opens
 * its details in place, under the line, as a list of label and value
 * (Power-on, Health check, Bad sectors, Wear…), and again closes them
 * (`aria-expanded`). A row with none (a drive held with no reading) is plain
 * content. `highlight` (a drive's device, from a link) opens that row and
 * marks it with the accent tint, scrolled into view without taking focus (its
 * quiet text steps up to text-2 on the tint, which text-3 would not clear in
 * the light theme).
 *
 * `view` is src/shell/detail/driveView.js's: `{ count, summary, tone,
 * standby, rows: [{ key, device, name, state, word, temperature, line,
 * details: [{ key, label, value, state? }] }] }`. `standby` adds the footnote
 * under the panel, "Sleeping drives show their last reading", for a node with
 * a drive that may sleep. This draws what the server judged and delivered; it
 * never shows a serial number, which no record carries.
 *
 * The lamp's slash and bar are cut in the panel's own colour (surface-2) here,
 * as the mock draws them.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { DetailSection } from './entity-detail.jsx';
import { StatusLamp } from './status-lamp.jsx';
import { cn } from './lib/utils.js';

const WORD_COLOUR = {
  ok: 'text-text-2',
  warn: 'text-warn-fg',
  crit: 'text-crit-fg',
  unknown: 'text-unknown-fg',
  maintenance: 'text-maintenance-fg',
};

const COUNT_COLOUR = {
  ok: 'text-text-3',
  warn: 'text-warn-fg',
  crit: 'text-crit-fg',
  unknown: 'text-unknown-fg',
  maintenance: 'text-maintenance-fg',
};

export const STANDBY_NOTE = 'Sleeping drives show their last reading';

function Row({ row, open, highlighted, onToggle }) {
  const panelId = useId();
  const lineId = `${panelId}-line`;
  const ref = useRef(null);
  const expandable = row.details.length > 0;
  const speaks = Boolean(row.word);
  useEffect(() => {
    // A drive a link names comes into view, and keeps focus where it was.
    if (highlighted) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [highlighted]);
  const head = (
    <>
      <span className="flex min-w-0 items-center gap-2.5">
        {/* Named by its word where nothing beside it says it: a button names
            itself ("sda, Healthy") and a lamp inside one is decorative. */}
        <StatusLamp
          state={row.state}
          size={12}
          label={row.said}
          decorative={speaks || expandable}
        />
        <span className="min-w-0 font-mono text-body-sm font-semibold wrap-anywhere text-text-1">
          {row.name}
        </span>
        {speaks && (
          <span
            data-slot="drive-word"
            className={cn('shrink-0 text-caption font-bold', WORD_COLOUR[row.state])}
          >
            {row.word}
          </span>
        )}
        {row.temperature && (
          <span
            data-slot="drive-temperature"
            className={cn(
              'ml-auto shrink-0 text-caption tabular-nums',
              highlighted ? 'text-text-2' : 'text-text-3'
            )}
          >
            {row.temperature}
          </span>
        )}
        {expandable && (
          <ChevronDown
            aria-hidden="true"
            strokeWidth={1.75}
            className={cn(
              'size-3.5 shrink-0 text-text-3 transition-transform',
              !row.temperature && 'ml-auto',
              open && 'rotate-180'
            )}
          />
        )}
      </span>
      {row.line && (
        <span
          id={lineId}
          data-slot="drive-line"
          className="block pl-[22px] text-caption wrap-anywhere text-text-2"
        >
          {row.line}
        </span>
      )}
    </>
  );
  return (
    <li
      ref={ref}
      data-slot="drive-row"
      data-drive={row.device}
      data-state={row.state}
      data-highlighted={highlighted ? '' : undefined}
      className={cn('min-w-0', highlighted && 'bg-accent-tint')}
    >
      {expandable ? (
        <button
          type="button"
          aria-label={`${row.name}, ${row.said}${row.temperature ? `, ${row.temperature}` : ''}`}
          aria-describedby={row.line ? lineId : undefined}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="flex w-full cursor-pointer flex-col gap-0.5 px-3.5 py-2.5 text-left -outline-offset-2 transition-colors hover:bg-row-hover"
        >
          {head}
        </button>
      ) : (
        <div className="flex flex-col gap-0.5 px-3.5 py-2.5">{head}</div>
      )}
      {expandable && open && (
        <dl
          id={panelId}
          data-slot="drive-details"
          className="grid gap-1 pr-3.5 pb-3 pl-[2.375rem] text-caption"
        >
          {row.details.map((d) => (
            <div key={d.key} className="flex justify-between gap-3">
              <dt className={cn('shrink-0', highlighted ? 'text-text-2' : 'text-text-3')}>
                {d.label}
              </dt>
              <dd
                className={cn(
                  'min-w-0 text-right font-semibold wrap-anywhere',
                  d.state ? WORD_COLOUR[d.state] : 'text-text-1'
                )}
              >
                {d.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

/**
 * @param {{ view: any, highlight?: string | null, title?: string, className?: string }} props
 */
function DetailDrives({ view, highlight = null, title = 'Drives', className, ...props }) {
  // The rows open by the user, and the one a link names, open from the render
  // that has it (state kept while the link's drive is the same).
  const [opened, setOpened] = useState(() => new Set());
  const [named, setNamed] = useState(null);
  if (highlight !== named) {
    setNamed(highlight);
    if (highlight) setOpened((s) => new Set(s).add(highlight));
  }
  if (!view || !view.rows?.length) return null;
  const toggle = (key) =>
    setOpened((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <DetailSection
      data-slot="detail-drives"
      title={title}
      aside={<span className={COUNT_COLOUR[view.tone] ?? COUNT_COLOUR.ok}>{view.summary}</span>}
      className={className}
      {...props}
    >
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-2 [--jh-lamp-cut:var(--jh-surface-2)]">
        {view.rows.map((row) => (
          <Row
            key={row.key}
            row={row}
            open={opened.has(row.key)}
            highlighted={highlight === row.device}
            onToggle={() => toggle(row.key)}
          />
        ))}
      </ul>
      {view.standby && (
        <p data-slot="detail-drives-standby" className="text-caption text-text-3">
          {STANDBY_NOTE}
        </p>
      )}
    </DetailSection>
  );
}

export { DetailDrives };
