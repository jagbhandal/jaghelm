/*
 * SourceList (#318, spec §7): Settings → Sources, the sources JagHelm reads in
 * one panel, a row each, as the mock's Settings board lists its data sources.
 *
 * A row: its lamp; the source's name, a heading (h3 under the panel's h2) in
 * the row whose `id` is its anchor, so a search match opens the page at it;
 * where it is set (`setting`, "Set in .env as" and the variable in mono,
 * PROMETHEUS_URL, with any words after it; none for one not set up, whose
 * detail says what to set);
 * what it says now and for how long ("Answering · for 3 h"), the word in its
 * state's colour; on failure the error as the model gives it, whole (it wraps,
 * however long: never cut, never reworded), in the warning's word colour
 * while the lamp is a warning; its lines of detail in `text-2` (the cron
 * reporters' counts, or what to set); and a link (the Jobs section). From
 * 576px of the row's own width (`@xl`) where it is set sits beside the name;
 * narrower, under it.
 *
 * A source that isn't set up (`state` null) has no lamp: its word, in
 * `text-3`, says so. A row is plain content, not a control: its lamp is
 * decorative where the word says what it draws (lampName) and named "No
 * signal" where a stale status draws it so beside the word last known (#480).
 *
 * Props: `title` and `description` (the panel's), `note` (a stale status's
 * "No signal · last known 3 min ago", at the end of the panel's header),
 * `rows` (each `{ id, name, setting, state, word, since, error, detail,
 * link }`; `setting` `{ label, variable, after }` or null, `detail` a line or
 * a list of them, `since` "for 3 h", `link` `{ href, label }`),
 * `onNavigate(event, href)` (the router's followLink, so a modified click
 * opens a new tab).
 */
import { StatusLamp } from './status-lamp.jsx';
import { StatusWord } from './status-word.jsx';
import { Panel } from './panel.jsx';
import { cn } from './lib/utils.js';
import { WORDS, lampName, toState } from './lib/status.js';

function SourceRow({ row, onNavigate }) {
  const s = row.state == null ? null : toState(row.state);
  const said = row.word || (s ? WORDS[s] : '');
  // The lamp's own name, where the word beside it doesn't say what it draws.
  const lamp = s && lampName(s, said) !== said ? lampName(s, said) : null;
  const { setting, link } = row;
  return (
    <li id={row.id} data-slot="source-row" data-state={s ?? 'none'} className="@container">
      <div className="flex items-start gap-3 px-panel py-3">
        {s ? (
          <StatusLamp state={s} label={lamp ?? undefined} decorative={!lamp} className="mt-1.25" />
        ) : (
          <span aria-hidden="true" className="w-2.5 shrink-0" />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-col @xl:flex-row @xl:items-baseline @xl:justify-between @xl:gap-x-4">
            <h3 className="text-body font-semibold text-text-1">{row.name}</h3>
            {setting ? (
              <p className="text-caption text-text-3">
                {setting.label} <code className="font-mono text-text-2">{setting.variable}</code>
                {setting.after}
              </p>
            ) : null}
          </div>
          <p className="text-body-sm">
            {s ? (
              <StatusWord state={s} word={said} />
            ) : (
              <span className="font-semibold text-text-3">{said}</span>
            )}
            {row.since ? <span className="text-text-3"> · {row.since}</span> : null}
          </p>
          {row.error ? (
            <p
              className={cn(
                'text-body-sm wrap-anywhere',
                s === 'warn' ? 'text-warn-fg' : 'text-text-2'
              )}
            >
              {row.error}
            </p>
          ) : null}
          {[row.detail ?? []].flat().map((line, n) => (
            <p key={n} className="text-body-sm text-text-2">
              {line}
            </p>
          ))}
          {link ? (
            <p className="text-body-sm">
              <a
                href={link.href}
                onClick={onNavigate ? (e) => onNavigate(e, link.href) : undefined}
                className="font-semibold text-accent-text hover:underline"
              >
                {link.label}
              </a>
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function SourceList({ title, description, note, rows = [], onNavigate, className, ...props }) {
  return (
    <Panel
      flush
      title={title}
      description={description}
      actions={
        note ? <span className="text-caption font-semibold text-unknown-fg">{note}</span> : null
      }
      className={className}
      {...props}
    >
      <ul data-slot="source-list" className="divide-y divide-border">
        {rows.map((row) => (
          <SourceRow key={row.id} row={row} onNavigate={onNavigate} />
        ))}
      </ul>
    </Panel>
  );
}

export { SourceList };
