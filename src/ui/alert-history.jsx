/*
 * AlertHistory and EventRow (#314): what happened, a day at a time, as the
 * Alerts page and the phone's Alerts tab draw the alert history (/api/events,
 * #267).
 *
 * EventRow is one event: its lamp (the alert's severity: crit, warn, or ok
 * for an info event such as a recovery), when, what (the entity's name over
 * where it is), the change ("Down → Up", or what it became) and why, and what
 * the phones got ("Sent to 2 phones"). `event` is the row
 * src/shell/alertsView.js historyRow builds: `{ state, name, where, change,
 * reason, at, time, delivery, gone }`. Like IssueRow, a row with an entity is
 * a link (`href`, and `onOpen` to open it in the page), named "name,
 * severity, change, where, time" and described by its reason and delivery; a
 * row with none (the status check's own event, an Arcane notice) is plain
 * content. An entity the model no longer has says "No longer monitored"
 * under its name, and still opens (its detail says so too).
 *
 *  - From 672px (`@2xl` of its own container), the attention panel's columns:
 *    the lamp, the time, the name over where, the change (bold, in its
 *    state's word colour; an ok change stays text-1: healthy stays quiet)
 *    then the reason, what the phones got (a 184px column, so the columns
 *    line up from row to row), and a chevron; 48px tall at least.
 *  - Narrower, the phone's: the lamp, "name · change" over the reason, over
 *    where and what the phones got, and the time; 56px tall at least.
 *  - The name is never cut short (an EntityRow's rule): a long one wraps,
 *    and narrow, the change goes to the next line when it doesn't fit beside
 *    it.
 *
 * AlertHistory is the History section: its heading ("History", with "Last 30
 * days"; `heading="overline"`, the phone screens' section label, "History ·
 * last 30 days", as their "Active" is drawn), then by `state`:
 *
 *   loading  placeholders, the region busy, "Loading the history" said once
 *   ok       `days` ([{ day, label, rows }], newest first), each day an
 *            overline label over its rows, in one card; none, the `empty`
 *            line. `onMore` adds "Show older" under them (busy while
 *            `loadingMore`). `failed`: a later read failed, and a line above
 *            the rows says so, with Retry.
 *   old      the server has no history (older than /api/events): one line,
 *            `old`, no error
 *   error    the history can't be read: a Banner that says so, with Retry
 *            (`onRetry`). Never the empty line: a failure is not "nothing
 *            happened".
 */
import { useId } from 'react';
import { ChevronRight } from 'lucide-react';
import { Banner } from './banner.jsx';
import { Button } from './button.jsx';
import { Skeleton } from './skeleton.jsx';
import { StatusLamp } from './status-lamp.jsx';
import { cn } from './lib/utils.js';
import { openHere } from './lib/link.js';
import { toState } from './lib/status.js';

// An ok change (a recovery) stays text-1: healthy stays quiet (rule 3).
const CHANGE = {
  ok: 'text-text-1',
  warn: 'text-warn-fg',
  crit: 'text-crit-fg',
  unknown: 'text-unknown-fg',
  maintenance: 'text-maintenance-fg',
};

/** The lamp's name: the alert's severity. */
const SEVERITY = { crit: 'Critical', warn: 'Warning', ok: 'Info' };

const GONE = 'No longer monitored';

function EventRow({ event: e, href, onOpen, className, ...props }) {
  const id = useId();
  const s = toState(e.state);
  const severity = SEVERITY[s] ?? 'No signal';
  const where = [e.where, e.gone && GONE].filter(Boolean).join(' · ') || undefined;
  const opens = Boolean(href || onOpen);
  const Tag = href ? 'a' : onOpen ? 'button' : 'div';
  const described = [e.reason && `${id}-reason`, e.cause && `${id}-cause`, e.delivery && `${id}-delivery`].filter(Boolean);
  const action =
    Tag === 'button'
      ? { type: 'button', onClick: () => onOpen() }
      : Tag === 'a'
        ? { href, onClick: onOpen ? (ev) => openHere(ev, onOpen) : undefined }
        : {};
  const iso = Number.isFinite(e.at) ? new Date(e.at).toISOString() : undefined;
  const name = [e.name, severity, e.change, where, e.time].filter(Boolean).join(', ');

  return (
    <Tag
      data-slot="event-row"
      data-state={s}
      aria-label={opens ? name : undefined}
      aria-describedby={opens && described.length ? described.join(' ') : undefined}
      className={cn(
        '@container block w-full text-left text-text-1',
        opens && 'cursor-pointer -outline-offset-2 transition-colors hover:bg-row-hover',
        className
      )}
      {...action}
      {...props}
    >
      <span className="grid min-h-14 grid-cols-[12px_minmax(0,1fr)_auto] items-start gap-x-3 px-3.5 py-2.5 @2xl:min-h-12 @2xl:grid-cols-[18px_44px_minmax(140px,1fr)_minmax(200px,2fr)_184px_16px] @2xl:items-center @2xl:px-panel @2xl:py-2">
        <StatusLamp state={s} label={severity} className="mt-1.25 @2xl:mt-0" />
        {e.time && (
          <time
            dateTime={iso}
            className="hidden text-caption text-text-3 tabular-nums @2xl:col-start-2 @2xl:row-start-1 @2xl:block"
          >
            {e.time}
          </time>
        )}
        <span className="flex min-w-0 flex-col @2xl:contents">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-1 @2xl:col-start-3 @2xl:row-start-1 @2xl:flex-col @2xl:flex-nowrap @2xl:items-stretch @2xl:gap-0">
            <span className="min-w-0 font-bold wrap-anywhere @2xl:font-semibold">{e.name}</span>
            {e.change && (
              <span className={cn('font-bold @2xl:hidden', CHANGE[s])}>
                <span aria-hidden="true">· </span>
                {e.change}
              </span>
            )}
            {where && (
              <span className="hidden truncate text-caption leading-5 text-text-3 @2xl:block">
                {where}
              </span>
            )}
          </span>
          {(e.change || e.reason || e.cause) && (
            <span className="text-body-sm leading-5 text-text-2 @2xl:col-start-4 @2xl:row-start-1 @2xl:text-body">
              {e.change && (
                <span className={cn('hidden font-bold @2xl:inline', CHANGE[s])}>{e.change}</span>
              )}
              {e.change && e.reason && (
                <span aria-hidden="true" className="hidden @2xl:inline">
                  {' · '}
                </span>
              )}
              {e.reason && <span id={`${id}-reason`}>{e.reason}</span>}
              {e.cause && (
                <span id={`${id}-cause`} className="text-text-3">
                  {(e.change || e.reason) && <span aria-hidden="true">{' · '}</span>}
                  Known cause: {e.cause}
                </span>
              )}
            </span>
          )}
          {(where || e.delivery) && (
            <span className="text-caption leading-5 text-text-3 @2xl:hidden">
              {[where, e.delivery].filter(Boolean).join(' · ')}
            </span>
          )}
        </span>
        {e.delivery && (
          <span
            id={`${id}-delivery`}
            className="hidden text-caption whitespace-nowrap text-text-3 @2xl:col-start-5 @2xl:row-start-1 @2xl:block @2xl:text-right"
          >
            {e.delivery}
          </span>
        )}
        {e.time && (
          <time
            dateTime={iso}
            className="pt-px text-caption whitespace-nowrap text-text-3 tabular-nums @2xl:hidden"
          >
            {e.time}
          </time>
        )}
        {opens && (
          <ChevronRight
            aria-hidden="true"
            strokeWidth={1.75}
            className="hidden size-3.5 text-text-3 @2xl:col-start-6 @2xl:row-start-1 @2xl:block"
          />
        )}
      </span>
    </Tag>
  );
}

const CARD = 'rounded-xl border border-border bg-surface-1';

function AlertHistory({
  days = [],
  state = 'ok',
  failed = false,
  onRetry,
  onMore,
  loadingMore = false,
  empty = 'No alerts in the last 30 days.',
  old = 'History needs a newer JagHelm server.',
  titleAs = 'h2',
  heading = 'title',
  className,
  ...props
}) {
  const Title = titleAs;
  const level = /^h[1-5]$/.test(titleAs) ? Number(titleAs[1]) + 1 : 6;
  const DayTitle = `h${level}`;
  const retry = onRetry && (
    <Button size="sm" onClick={onRetry}>
      Retry
    </Button>
  );
  return (
    <section
      data-slot="alert-history"
      data-state={state}
      aria-label="History"
      aria-busy={state === 'loading' || undefined}
      className={cn('flex flex-col gap-2 text-text-1', className)}
      {...props}
    >
      {heading === 'overline' ? (
        <Title className="text-overline text-text-3 uppercase">History · last 30 days</Title>
      ) : (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <Title className="text-title-sm">History</Title>
          <span className="text-caption text-text-3">Last 30 days</span>
        </div>
      )}

      {state === 'loading' && (
        <div className={cn('flex flex-col gap-3 p-panel', CARD)}>
          <span className="sr-only">Loading the history</span>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      )}

      {state === 'old' && (
        <p className={cn('px-panel py-3 text-body-sm text-text-2', CARD)}>{old}</p>
      )}

      {state === 'error' && (
        <Banner
          tone="unknown"
          title="History unavailable"
          cause="JagHelm didn't send it. Nothing here doesn't mean nothing happened."
          action={retry}
        />
      )}

      {state === 'ok' && (
        <>
          {failed && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-text-2">
              <span>Couldn't refresh the history. This is what it last said.</span>
              {retry}
            </div>
          )}
          {days.length === 0 ? (
            <p className={cn('px-panel py-3 text-body-sm text-text-2', CARD)}>{empty}</p>
          ) : (
            <div className={cn('overflow-hidden', CARD)}>
              {days.map((day, i) => (
                <div key={day.day} className={cn(i > 0 && 'border-t border-border')}>
                  <DayTitle className="px-panel pt-3 pb-1.5 text-overline text-text-3 uppercase">
                    {day.label}
                  </DayTitle>
                  <ul className="divide-y divide-border border-t border-border">
                    {day.rows.map((row) => (
                      <li key={row.id}>
                        <EventRow event={row} href={row.href} onOpen={row.onOpen} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          {onMore && (
            <Button
              size="sm"
              onClick={onMore}
              disabled={loadingMore}
              aria-busy={loadingMore || undefined}
              className="self-center"
            >
              {loadingMore ? 'Loading older…' : 'Show older'}
            </Button>
          )}
        </>
      )}
    </section>
  );
}

export { AlertHistory, EventRow };
