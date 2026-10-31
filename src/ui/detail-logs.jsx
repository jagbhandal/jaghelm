/*
 * DetailLogs (#672): "Recent errors" in an entity's detail, the last error-ish
 * lines of a node or a service from Loki, read-only, under the heading's
 * "last 6 h". `state` is what the screen read: `loading` (a quiet line),
 * `ok` with `lines` (`{ at, text, level? }`, newest first: the clock time, a
 * level marker, then the line in 12px mono, wrapping anywhere so a long token can't widen the
 * drawer; the list sits in its own region, at most 18rem high, scrolling
 * inside itself: a keyboard stop labelled "Error log lines", the heading and
 * "last 6 h" fixed above it, `overscroll-auto` so a phone's sheet takes the
 * scroll at the list's ends), `none` ("No errors in the last 6 h": the
 * target did send logs), `silent` (it sent none: "No logs received from <it>:
 * check the Loki host label", `reason` names it), or `unavailable` with its `reason` as a plain
 * sentence, never an error. The marker (#844) is the server's `level`
 * (server/lokiLogs.js `levelOf`): `fatal`, `error` or `warn` draw a word in a
 * 10px uppercase mono badge on the status tint (`fatal` on the solid), so the
 * level never rests on colour alone and survives forced colours (the badge keeps
 * its border). `other`, a missing `level` (an older server) or any word this
 * client doesn't know draws no marker, never a guess; once any line in the
 * list has one, the rest keep an empty cell of its width so the text aligns.
 * No count above the list: it holds at most 20 lines, so a count would read as
 * the totals. The text is the server's, already cleaned
 * (server/lokiLogs.js); it is drawn as text, never as markup.
 *
 * Its own module, so it rides only in the chunk of the detail that draws it.
 */
import { DetailSection } from './entity-detail.jsx';
import { cn } from './lib/utils.js';

/** The level markers: the word shown, and the status classes of its badge (all checked pairings). */
const MARKS = {
  fatal: { word: 'Fatal', cls: 'border-crit-border bg-crit-solid text-crit-on-solid' },
  error: { word: 'Error', cls: 'border-crit-border bg-crit-tint text-crit-fg' },
  warn: { word: 'Warn', cls: 'border-warn-border bg-warn-tint text-warn-fg' },
};
const markOf = (level) => (typeof level === 'string' && Object.hasOwn(MARKS, level) ? MARKS[level] : null);

const clock = (ms) => {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (x) => String(x).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

function DetailLogs({ state = 'loading', lines = [], reason = null, className, ...props }) {
  const marked = lines.some((l) => markOf(l?.level));
  return (
    <DetailSection
      data-slot="detail-logs"
      data-state={state}
      title="Recent errors"
      aside="last 6 h"
      className={className}
      {...props}
    >
      {state === 'ok' && lines.length > 0 ? (
        <div
          data-slot="detail-logs-scroll"
          role="region"
          aria-label="Error log lines"
          tabIndex={0}
          className="max-h-[18rem] min-w-0 overflow-x-hidden overflow-y-auto overscroll-auto rounded-xs"
        >
          <ol className="m-0 flex list-none flex-col gap-1 p-0">
            {lines.map((l, i) => (
              <li key={`${l.at}-${i}`} className="flex min-w-0 gap-2 text-caption">
                <time className="shrink-0 font-mono text-text-3">{clock(l.at)}</time>
                {(() => {
                  const m = markOf(l.level);
                  if (m) {
                    return (
                      <span
                        data-slot="detail-logs-level"
                        data-level={l.level}
                        className={cn(
                          'box-border inline-flex h-4 w-[3.25rem] shrink-0 items-center justify-center self-start rounded-xs border font-mono text-badge uppercase',
                          m.cls
                        )}
                      >
                        {m.word}
                      </span>
                    );
                  }
                  return marked ? <span aria-hidden="true" className="w-[3.25rem] shrink-0" /> : null;
                })()}
                <span className={cn('min-w-0 font-mono text-text-2 [overflow-wrap:anywhere]')}>
                  {l.text}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="m-0 text-caption text-text-3">
          {state === 'loading' && 'Reading logs…'}
          {state === 'none' && 'No errors in the last 6 h.'}
          {state === 'silent' &&
            `No logs received from ${reason || 'here'} in the last 6 h: check the Loki host label.`}
          {state !== 'loading' &&
            state !== 'none' &&
            state !== 'silent' &&
            `Logs unavailable${reason ? `: ${reason}` : ''}.`}
        </p>
      )}
    </DetailSection>
  );
}

export { DetailLogs };
