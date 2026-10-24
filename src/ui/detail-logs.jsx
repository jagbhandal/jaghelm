/*
 * DetailLogs (#672): "Recent errors" in an entity's detail, the last error-ish
 * lines of a node or a service from Loki, read-only, under the heading's
 * "last 6 h". `state` is what the screen read: `loading` (a quiet line),
 * `ok` with `lines` (`{ at, text }`, newest first: the clock time, then the
 * line in 12px mono, wrapping anywhere so a long token can't widen the
 * drawer), `none` ("No errors in the last 6 h, or no logs received": a host
 * that is off sends none), or `unavailable` with its `reason` as a plain
 * sentence, never an error. The text is the server's, already cleaned
 * (server/lokiLogs.js); it is drawn as text, never as markup.
 *
 * Its own module, so it rides only in the chunk of the detail that draws it.
 */
import { DetailSection } from './entity-detail.jsx';
import { cn } from './lib/utils.js';

const clock = (ms) => {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (x) => String(x).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

function DetailLogs({ state = 'loading', lines = [], reason = null, className, ...props }) {
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
        <ol className="m-0 flex list-none flex-col gap-1 p-0">
          {lines.map((l, i) => (
            <li key={`${l.at}-${i}`} className="flex min-w-0 gap-2 text-caption">
              <time className="shrink-0 font-mono text-text-3">{clock(l.at)}</time>
              <span className={cn('min-w-0 font-mono text-text-2 [overflow-wrap:anywhere]')}>
                {l.text}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="m-0 text-caption text-text-3">
          {state === 'loading' && 'Reading logs…'}
          {state === 'none' && 'No errors in the last 6 h, or no logs received.'}
          {state !== 'loading' &&
            state !== 'none' &&
            `Logs unavailable${reason ? `: ${reason}` : ''}.`}
        </p>
      )}
    </DetailSection>
  );
}

export { DetailLogs };
