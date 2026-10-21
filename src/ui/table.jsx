/*
 * Table (spec §5.4, §8; #288): rows of figures to compare, the mock's
 * Infrastructure table (its Cards / Table toggle): a flat panel, overline
 * column headers, rows as tall as the density with a subtle rule between them,
 * 13px text, numbers right-aligned in tabular figures.
 *
 * `columns` is `[{ key, header, numeric, cell, className }]`: `cell(row)`
 * draws a cell (a StatusLamp and StatusWord, a name and a host), else the
 * row's value at `key` is printed; `numeric` right-aligns the column, header
 * and cells. `rows` are objects, keyed by `rowKey` (`id` by default).
 *
 * Built for the keyboard and screen readers: a real <table> named by its
 * `caption` (hidden, the panel's heading shows it), an `aria-label`, or the
 * heading's id as `aria-labelledby`; `scope`d column headers; and each row
 * named by its first cell, a row header. With `onRowOpen` the rows open
 * something: the first cell is a button (Tab reaches each row, Enter or Space
 * opens it), and a click anywhere on the row opens it too, except on a link or
 * control a cell holds. Cells keep to one line (a column's `className` can let
 * its cells wrap), so rows stay one `h-row` tall; a table wider than its
 * frame scrolls inside it (`minWidth`, 720px in the mock), and only then is
 * the frame a region, named as the table, that Tab reaches, so the keyboard
 * can scroll it. The frame holds what a cell positions too (a cell's words for
 * screen readers, `sr-only`), so nothing in a scrolled-off column reaches
 * past it and scrolls the page sideways (#299). Cells are 12px apart, 16px at the table's ends, as the mock's.
 */
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { cn } from './lib/utils.js';
import { hasText } from './lib/name.js';

/** Whether `el` is wider inside than it shows, kept up to date as it resizes. */
function useOverflows(ref) {
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const check = () => setOverflows(el.scrollWidth > el.clientWidth);
    check();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(check);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [ref]);
  return overflows;
}

// A click opens the row, unless it was on a control of its own inside a cell
// (a link, a button, a field); the row's own open button is the exception.
const opens = (e) => {
  const control = e.target.closest?.('a, button, input, select, textarea, label');
  return !control || control.dataset.slot === 'table-open';
};

// 12px between columns, 16px at both ends of the first and last, as the mock.
const cellPad = 'px-3 first:px-4 last:px-4';

function Table({
  caption,
  columns = [],
  rows = [],
  rowKey = 'id',
  onRowOpen,
  empty = 'Nothing to show',
  minWidth,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': labelledBy,
  ...props
}) {
  const id = useId();
  const frameRef = useRef(null);
  const overflows = useOverflows(frameRef);
  if (!hasText(caption) && !hasText(ariaLabel) && !labelledBy) {
    const message =
      'Table needs a `caption`, or an `aria-label` or `aria-labelledby` without one: it has no name';
    if (import.meta.env.DEV) throw new Error(message);
    console.error(message);
  }
  const keyOf = (row, i) => (typeof rowKey === 'function' ? rowKey(row) : (row[rowKey] ?? i));
  const name = hasText(caption)
    ? { 'aria-labelledby': `${id}-caption` }
    : labelledBy
      ? { 'aria-labelledby': labelledBy }
      : { 'aria-label': ariaLabel };

  return (
    <div
      ref={frameRef}
      data-slot="table"
      className={cn(
        'relative overflow-x-auto rounded-xl border border-border-subtle bg-surface-1',
        className
      )}
      {...(overflows ? { role: 'region', tabIndex: 0, ...name } : {})}
      {...props}
    >
      <table
        className="w-full border-collapse text-body-sm"
        style={minWidth ? { minWidth } : undefined}
        aria-label={hasText(caption) || labelledBy ? undefined : ariaLabel}
        aria-labelledby={hasText(caption) ? undefined : labelledBy}
      >
        {hasText(caption) && (
          <caption id={`${id}-caption`} className="sr-only">
            {caption}
          </caption>
        )}
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  'py-2.5 text-overline leading-5 whitespace-nowrap text-text-3 uppercase',
                  cellPad,
                  c.numeric ? 'text-right' : 'text-left'
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="h-row border-t border-border-subtle">
              <td colSpan={columns.length || 1} className={cn('text-text-3', cellPad)}>
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={keyOf(row, i)}
                className={cn(
                  'h-row border-t border-border-subtle',
                  onRowOpen && 'cursor-pointer transition-colors hover:bg-row-hover'
                )}
                onClick={onRowOpen ? (e) => opens(e) && onRowOpen(row) : undefined}
              >
                {columns.map((c, j) => {
                  const content = c.cell ? c.cell(row) : row[c.key];
                  const align = c.numeric ? 'text-right tabular-nums' : 'text-left';
                  if (j > 0) {
                    return (
                      <td
                        key={c.key}
                        className={cn('whitespace-nowrap', cellPad, align, c.className)}
                      >
                        {content}
                      </td>
                    );
                  }
                  return (
                    <th
                      key={c.key}
                      scope="row"
                      className={cn(
                        'font-bold whitespace-nowrap text-text-1',
                        cellPad,
                        align,
                        c.className
                      )}
                    >
                      {onRowOpen ? (
                        <button
                          type="button"
                          data-slot="table-open"
                          className="cursor-pointer rounded-sm text-left"
                        >
                          {content}
                        </button>
                      ) : (
                        content
                      )}
                    </th>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export { Table };
