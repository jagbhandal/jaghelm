/*
 * ThresholdTable (#320, spec §6.1, §7): Settings → Notifications' threshold
 * lines, a row per metric (CPU, memory, disk, temperature), as the mock's
 * Notifications board lists them: the metric's name and what it covers; a
 * field for its warning line and one for its critical line, each with its
 * unit beside it ("%", "°C"), or "None" for a metric that has no critical
 * level; its defaults under them; and "Reset to default" while the row is
 * set away from them. Each field and Reset name their metric for a screen
 * reader (visually hidden: "Warning at for CPU"). A row's error (what the
 * server or the page refused) shows under it in crit's word colour, with the
 * field marked invalid and tied to it by aria-describedby; it is not an
 * alert, so typing doesn't announce it. A row's `notice` (lines loaded
 * already wrong) shows the same way in warn's colour, marking nothing invalid.
 *
 * One Save for the table, primary, with Discard beside it while there are
 * changes, and a line saying what happened (`status`: "Saved…", or why not).
 * `readOnly` (the demo) draws the fields locked and no Save.
 *
 * Props: `title`, `description` (the panel's), `id` (its anchor), `rows`
 * (each `{ metric, label, hint, unit, warn, crit, defaults, error, notice }`: `warn`
 * and `crit` the fields' text, crit null for none; `defaults` `{ warn, crit }`
 * as numbers; `custom` whether the row differs from them), `onChange(metric,
 * field, text)`, `onReset(metric)`, `onRowBlur(metric)` (focus left the row), `dirty`, `saving`, `status` (`{ tone:
 * 'error' | 'info', text }` or null; an error in crit's word colour, as a
 * field's error), `onSave()`, `onDiscard()`,
 * `readOnly`, and `unread` (`{ loading, error, onRetry }`: the rows aren't
 * read yet, or couldn't be, and why, with Try again, in place of them).
 */
import { Button } from './button.jsx';
import { Input } from './input.jsx';
import { Panel } from './panel.jsx';
import { cn } from './lib/utils.js';

/**
 * In place of a panel's rows while they load, or why they couldn't be read,
 * with Try again (`onRetry`). Shared with PushDevices.
 */
function Unread({ loading = false, error = null, onRetry }) {
  if (!error) {
    return <p className="px-panel py-4 text-body-sm text-text-3">{loading ? 'Loading…' : ''}</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-3 px-panel py-4">
      <p role="alert" className="text-body-sm text-crit-fg">
        {error}
      </p>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={() => onRetry()}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/** "90 %", "75 °C". */
const withUnit = (value, unit) => `${value} ${unit}`;

function LineField({ label, name, metric, field, value, unit, invalid, note, readOnly, onChange }) {
  const id = `threshold-${metric}-${field}`;
  return (
    <div className="flex w-32 flex-col gap-1">
      <label htmlFor={id} className="text-caption font-semibold text-text-2">
        {label} <span className="sr-only">for {name}</span>
      </label>
      <span className="flex items-center gap-1.5">
        <Input
          id={id}
          inputMode="decimal"
          value={value}
          readOnly={readOnly}
          aria-invalid={invalid || undefined}
          aria-describedby={note}
          onChange={(e) => onChange?.(metric, field, e.target.value)}
          className="w-20 text-right tabular-nums"
        />
        <span className="text-body-sm text-text-3">{unit}</span>
      </span>
    </div>
  );
}

function ThresholdRow({ row, readOnly, onChange, onReset, onRowBlur }) {
  const { metric, unit, defaults } = row;
  // What a row says about itself (an error, or a notice) is tied to its fields.
  const noteId = row.error || row.notice ? `threshold-${metric}-note` : undefined;
  const defaultsText =
    defaults.crit == null
      ? `Default ${withUnit(defaults.warn, unit)}`
      : `Defaults ${withUnit(defaults.warn, unit)} and ${withUnit(defaults.crit, unit)}`;
  return (
    <li
      data-slot="threshold-row"
      data-metric={metric}
      className="@container"
      onBlur={(e) => {
        // Focus left the row (not just moved between its fields).
        if (!e.currentTarget.contains(e.relatedTarget)) onRowBlur?.(metric);
      }}
    >
      <div className="flex flex-col gap-3 px-panel py-3 @xl:flex-row @xl:items-start @xl:gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 @xl:pt-5">
          <h3 className="text-body font-semibold text-text-1">{row.label}</h3>
          {row.hint ? <p className="text-caption text-text-3">{row.hint}</p> : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-end gap-4">
            <LineField
              label="Warning at"
              name={row.label}
              note={noteId}
              metric={metric}
              field="warn"
              value={row.warn}
              unit={unit}
              invalid={Boolean(row.error)}
              readOnly={readOnly}
              onChange={onChange}
            />
            {row.crit == null ? (
              <div className="flex w-32 flex-col gap-1">
                <span className="text-caption font-semibold text-text-2">Critical at</span>
                <span className="flex h-control items-center text-body-sm text-text-3">
                  None: warns only
                </span>
              </div>
            ) : (
              <LineField
                label="Critical at"
                name={row.label}
                note={noteId}
                metric={metric}
                field="crit"
                value={row.crit}
                unit={unit}
                invalid={Boolean(row.error)}
                readOnly={readOnly}
                onChange={onChange}
              />
            )}
          </div>
          <div className="flex min-h-control-sm flex-wrap items-center gap-x-3">
            <span className="text-caption text-text-3">{defaultsText}</span>
            {row.custom && !readOnly ? (
              <Button variant="ghost" size="sm" tone="accent" onClick={() => onReset?.(metric)}>
                Reset to default <span className="sr-only">for {row.label}</span>
              </Button>
            ) : null}
          </div>
          {row.error ? (
            <p id={noteId} className="max-w-sm text-body-sm text-crit-fg">
              {row.error}
            </p>
          ) : row.notice ? (
            <p id={noteId} className="max-w-sm text-body-sm text-warn-fg">
              {row.notice}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function ThresholdTable({
  title = 'Thresholds',
  description,
  rows = [],
  onChange,
  onReset,
  onRowBlur,
  dirty = false,
  saving = false,
  status = null,
  onSave,
  onDiscard,
  readOnly = false,
  unread = null,
  className,
  children,
  ...props
}) {
  const statusLine = status ? (
    <p
      role="status"
      className={cn('text-body-sm', status.tone === 'error' ? 'text-crit-fg' : 'text-text-2')}
    >
      {status.text}
    </p>
  ) : null;
  return (
    <Panel flush title={title} description={description} className={className} {...props}>
      {unread ? <Unread {...unread} /> : null}
      {unread
        ? null
        : (children ?? (
            <>
              <ul data-slot="threshold-table" className="divide-y divide-border">
                {rows.map((row) => (
                  <ThresholdRow
                    key={row.metric}
                    row={row}
                    readOnly={readOnly}
                    onChange={onChange}
                    onReset={onReset}
                    onRowBlur={onRowBlur}
                  />
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-3 border-t border-border px-panel py-3">
                {readOnly ? null : (
                  <>
                    <Button
                      variant="primary"
                      disabled={!dirty || saving}
                      onClick={() => onSave?.()}
                    >
                      {saving ? 'Saving…' : 'Save thresholds'}
                    </Button>
                    {dirty && !saving ? (
                      <Button variant="ghost" onClick={() => onDiscard?.()}>
                        Discard changes
                      </Button>
                    ) : null}
                  </>
                )}
                {statusLine}
              </div>
            </>
          ))}
    </Panel>
  );
}

export { ThresholdTable, Unread };
