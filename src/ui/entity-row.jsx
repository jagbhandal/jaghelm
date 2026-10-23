/*
 * EntityRow (spec §5.4, §8; #288): one service, node or job in a list, the
 * mock's Services row: its lamp, its name, one headline detail ("24,499
 * assets", "Kuma: HTTP 502 for 4 min"), a short meta (latency) and a trailing
 * figure (an UptimeBar, a decorative Sparkline), with a chevron when it opens
 * something.
 *
 * The name is never truncated before anything else (spec §8, the card). The
 * name's column starts at the name's own width, and nothing else claims any
 * of it: the meta and the trailing figure start from nothing and widen into
 * the room the name leaves, up to their own width (a strip short of room
 * loses its oldest beats from the left; narrower than 672px a heartbeat strip
 * shows its newest 12, as the Phone board's), and the detail fills what is left
 * after them, ending in an ellipsis. Only a name wider than the whole row ends
 * in one. From 672px of its own width the name and the detail
 * share a line, the name keeping at least the mock's name column (3/7 of the
 * line) so details line up down a list. Narrower, it is the Phone board's
 * row: the name on its own line over the detail and the meta ("24,499 assets
 * · 138 ms", the meta never cut short), and the trailing figure; no chevron.
 *
 * Its height follows the density, `h-row` (40px, 32 compact) from 672px and
 * 12px more on a phone (the mock's 52px), padded by the panel's padding, with
 * the mock's 20px lines. From 672px a critical row takes `crit-tint`, as the
 * Overview board's (the Phone board's list leaves it plain: its issue list
 * says it); the detail is in `text-1` when healthy and in the state's word
 * colour otherwise. `row-hover` shows over the tint under the pointer.
 *
 * A row that opens something is a button (`onOpen`) or a link (`href`; with
 * an `onOpen` too, a plain click opens it in the page, lib/link.js), named
 * "name, word" and described by its where, detail, meta (unless only a dash) and
 * trailing figure (an UptimeBar's summary); its lamp is then decorative. A row with nothing to
 * open is plain content, its lamp named by the word. A lamp drawn as no signal
 * beside another word (a stale status's last known "Up", #480) is named "No
 * signal" (lampName), and so is the row. A Sparkline inside a row
 * that opens is `decorative`: a focusable chart inside a button is a control
 * inside a control.
 *
 * Two parts for a long list, the Overview's Services (#300): `muted` quiets a
 * healthy row (its detail in `text-2`, so a failing one stands out; any other
 * state keeps its colours), and `where` (a node's name) follows the name in
 * 12px mono `text-3`, inside the name's column, giving way before the name.
 */
import { useId } from 'react';
import { ChevronRight } from 'lucide-react';
import { StatusLamp } from './status-lamp.jsx';
import { cn } from './lib/utils.js';
import { openHere } from './lib/link.js';
import { WORDS, lampName, spoken, toState } from './lib/status.js';

const DASH = /^\s*[—–-]\s*$/;

const detailColour = {
  ok: 'text-text-1',
  warn: 'text-warn-fg',
  crit: 'text-crit-fg',
  unknown: 'text-unknown-fg',
  maintenance: 'text-maintenance-fg',
};

function EntityRow({
  state,
  word,
  name,
  where,
  detail,
  meta,
  trailing,
  muted = false,
  onOpen,
  href,
  className,
  ...props
}) {
  const id = useId();
  const s = toState(state);
  // A stale row keeps its last word ("Up"); its lamp is named by what it draws.
  const said = lampName(s, word || WORDS[s]);
  const quiet = muted && s === 'ok';
  const opens = Boolean(href || onOpen);
  const Tag = href ? 'a' : onOpen ? 'button' : 'div';
  const has = {
    where: where != null && where !== '',
    detail: detail != null,
    meta: meta != null,
    trailing: trailing != null,
  };
  // A meta that is only a dash ("no latency") says nothing: it stays on screen
  // and out of the row's description.
  const saysMeta = has.meta && !(typeof meta === 'string' && DASH.test(meta));
  const described = [
    has.where && 'where',
    has.detail && 'detail',
    saysMeta && 'meta',
    has.trailing && 'trailing',
  ]
    .filter(Boolean)
    .map((k) => `${id}-${k}`);
  const action =
    Tag === 'button'
      ? { type: 'button', onClick: () => onOpen() }
      : Tag === 'a'
        ? { href, onClick: onOpen ? (e) => openHere(e, onOpen) : undefined }
        : {};

  return (
    <Tag
      data-slot="entity-row"
      data-state={s}
      data-muted={quiet ? '' : undefined}
      aria-label={opens ? `${name}, ${spoken(said)}` : undefined}
      aria-describedby={opens && described.length ? described.join(' ') : undefined}
      className={cn(
        '@container block w-full text-left text-text-1',
        opens && 'cursor-pointer -outline-offset-2 transition-colors hover:bg-row-hover',
        className
      )}
      {...action}
      {...props}
    >
      <span
        data-slot="entity-grid"
        className={cn(
          'flex min-h-[calc(var(--jh-row-h)+12px)] items-center gap-3 px-3.5 py-2 @2xl:min-h-row @2xl:gap-3.5 @2xl:px-panel @2xl:py-1',
          s === 'crit' && '@2xl:bg-crit-tint'
        )}
      >
        <span className="flex w-3 shrink-0 @2xl:w-4">
          <StatusLamp state={s} label={said} decorative={opens} />
        </span>
        <span
          data-slot="entity-main"
          className="flex min-w-0 flex-auto flex-col @2xl:flex-row @2xl:items-center @2xl:gap-3.5"
        >
          {has.where ? (
            <span
              data-slot="entity-heading"
              className="flex min-w-0 items-baseline gap-2 @2xl:min-w-[calc(42.857%-6px)] @2xl:shrink"
            >
              <span
                data-slot="entity-name"
                className="block min-w-0 truncate font-semibold text-text-1"
              >
                {name}
              </span>
              <span
                data-slot="entity-where"
                id={`${id}-where`}
                className="block min-w-0 shrink-1000 truncate font-mono text-caption text-text-3"
              >
                {where}
              </span>
            </span>
          ) : (
            <span
              data-slot="entity-name"
              className="block truncate font-semibold text-text-1 @2xl:min-w-[calc(42.857%-6px)] @2xl:shrink"
            >
              {name}
            </span>
          )}
          {(has.detail || saysMeta) && (
            <span
              data-slot="entity-detail"
              id={has.detail ? `${id}-detail` : undefined}
              className={cn(
                'flex w-0 min-w-full truncate text-caption leading-5 @2xl:block @2xl:min-w-0 @2xl:flex-1 @2xl:text-body-sm @2xl:leading-5',
                !has.detail && '@2xl:hidden',
                quiet ? 'text-text-2' : detailColour[s]
              )}
            >
              {has.detail && (
                <span data-slot="entity-detail-text" className="min-w-0 truncate">
                  {detail}
                </span>
              )}
              {/* The Phone board's line, "metric · latency": the meta's own
                  element (hidden here) is what a screen reader hears. */}
              {saysMeta && (
                <span
                  data-slot="entity-detail-meta"
                  aria-hidden="true"
                  className="shrink-0 whitespace-pre @2xl:hidden"
                >
                  {has.detail ? ' · ' : ''}
                  {meta}
                </span>
              )}
            </span>
          )}
        </span>
        {has.meta && (
          <span
            data-slot="entity-meta"
            id={`${id}-meta`}
            className="hidden max-w-16 min-w-0 grow-1000 basis-0 truncate text-right text-caption text-text-3 @2xl:block"
          >
            {meta}
          </span>
        )}
        {has.trailing && (
          <span
            data-slot="entity-trailing"
            id={`${id}-trailing`}
            className="flex max-w-max min-w-0 grow-1000 basis-0 items-center justify-end overflow-hidden @max-2xl:[&_[data-slot=beat]:nth-last-child(n+13)]:hidden"
          >
            {trailing}
          </span>
        )}
        {opens && (
          <ChevronRight
            aria-hidden="true"
            strokeWidth={1.75}
            className="hidden size-3.5 shrink-0 text-text-3 @2xl:block"
          />
        )}
      </span>
    </Tag>
  );
}

export { EntityRow };
