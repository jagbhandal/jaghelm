/*
 * AppHeader (spec §5.4, §7; #296, #275): the annunciator header, 48px tall and
 * the full width of the window, above every page. Left to right:
 *
 *   brand      the logo and the instance name, a link to the Overview: the
 *              mock's helm mark on the accent, or `logoUrl` when one is set.
 *              Below 768px the name is for screen readers only.
 *   status     the overall state from the status model: its lamp, its word
 *              and the model's sentence, which carries the counts ("2 services
 *              down · 1 no signal"), the whole of it a link to Alerts. Healthy
 *              (ok, or only maintenance) says "All systems normal" in text-1,
 *              never in green (rule 3). An empty board (`EMPTY`, nothing set
 *              up, #449) is quiet too, with no lamp: the model's sentence,
 *              "Nothing monitored yet", in text-1, never "No signal" and never
 *              "All systems normal". `reach` other than 'ok' is no signal:
 *              the steel ring and "No signal", with why ("Can't reach
 *              JagHelm"), the same word and colour as the Android app.
 *              `reach` 'loading', before the first answer, is a placeholder,
 *              neither a state nor no signal. A live region, so a change is
 *              announced.
 *   updated    "Updated 12 s ago" (UpdatedAgo): its own component with its own
 *              clock, so its tick each second re-renders nothing else. From
 *              640px.
 *   search     opens the command palette; from 1024px the mock's wide button
 *              with the shortcut, narrower an icon, leaving the sentence room.
 *   settings   a link to Settings.
 *   logout     Log out, when the server asks for a sign-in.
 *
 * `onNavigate(event, href)` handles a link's click (the router's followLink),
 * so a modified click still opens a new browser tab.
 */
import { useEffect, useState } from 'react';
import { LogOut, Search, SlidersHorizontal } from 'lucide-react';
import { buttonVariants } from './button.jsx';
import { IconButton } from './icon-button.jsx';
import { Skeleton } from './skeleton.jsx';
import { StatusLamp } from './status-lamp.jsx';
import { StatusWord } from './status-word.jsx';
import { Tooltip } from './tooltip.jsx';
import { cn } from './lib/utils.js';
import { EMPTY, EMPTY_SENTENCE, WORDS, toState } from './lib/status.js';

/**
 * The overall states that read as quiet: maintenance never breaks the quiet
 * line (§6.1), and an empty board has nothing to break it (#449).
 */
const QUIET = new Set(['ok', 'maintenance', EMPTY]);

/** What the header says when it has no status to show, by why. */
export const NO_SIGNAL = Object.freeze({
  down: "Can't reach JagHelm",
  waiting: 'Waiting for the first check',
});

/** The mock's helm mark: the wheel, in on-accent, on an accent square. */
function HelmMark({ className }) {
  return (
    <span
      aria-hidden="true"
      data-slot="helm-mark"
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent text-on-accent shadow-control',
        className
      )}
    >
      <svg
        viewBox="0 0 24 24"
        className="size-4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
      >
        <circle cx="12" cy="12" r="6.2" />
        <path d="M12 1.8v6.4M12 15.8v6.4M1.8 12h6.4M15.8 12h6.4M4.8 4.8l4.5 4.5M14.7 14.7l4.5 4.5M19.2 4.8l-4.5 4.5M9.3 14.7l-4.5 4.5" />
        <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      </svg>
    </span>
  );
}

/** How long ago `ms` was, as the header says it: "just now", "12 s", "3 min", "2 h", "4 d". */
export function agoText(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

/**
 * How long ago `at` was (ms since the epoch), as agoText says it, on a clock
 * of its own that ticks each second, so only the component that asks
 * re-renders; null while `at` is. UpdatedAgo's, and the "No signal" banner's
 * "This is what it said 20 min ago" (#297).
 */
export function useAgo(at) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (at == null) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [at]);
  return at == null ? null : agoText(now - at);
}

/**
 * "Updated 12 s ago", for the time `at` (ms since the epoch; nothing before
 * the first update). It keeps its own clock (useAgo), so it re-renders alone.
 */
function UpdatedAgo({ at, className, ...props }) {
  const ago = useAgo(at);
  if (ago == null) return null;
  return (
    <span
      data-slot="updated-ago"
      className={cn('text-caption whitespace-nowrap text-text-3', className)}
      {...props}
    >
      Updated {ago}
    </span>
  );
}

function HeaderStatus({ status = {}, onNavigate }) {
  const { reach = 'ok', state, word, sentence, href = '/alerts', current } = status;
  if (reach === 'loading') {
    // Before the first answer: no state to show yet, and not "No signal" either.
    return (
      <div
        role="status"
        aria-busy="true"
        data-slot="header-status"
        className="flex min-w-0 flex-1 items-center gap-2.5"
      >
        <Skeleton className="size-3.5 rounded-full" />
        <Skeleton className="h-3 w-40 max-w-full" />
        <span className="sr-only">Checking status</span>
      </div>
    );
  }
  const signal = reach === 'ok';
  const s = !signal ? 'unknown' : state === EMPTY ? EMPTY : toState(state);
  const empty = s === EMPTY;
  const quiet = signal && QUIET.has(s);
  const said = !signal
    ? WORDS.unknown
    : word || (empty ? sentence || EMPTY_SENTENCE : quiet ? 'All systems normal' : WORDS[s]);
  // An empty board's sentence is its whole line, said once.
  const says = !signal ? NO_SIGNAL[reach] || NO_SIGNAL.down : sentence !== said ? sentence : null;
  return (
    <div role="status" data-slot="header-status" className="flex min-w-0 flex-1">
      <a
        href={href}
        aria-current={current ? 'page' : undefined}
        onClick={onNavigate ? (e) => onNavigate(e, href) : undefined}
        data-state={s}
        className="group/status flex min-w-0 items-center gap-2.5 rounded-md py-1 pr-1.5"
      >
        {!empty && <StatusLamp state={s} size="lg" decorative />}
        {quiet ? (
          <span className="shrink-0 text-title-xs text-text-1">{said}</span>
        ) : (
          <StatusWord state={s} word={said} className="shrink-0 text-title-xs" />
        )}
        {says && (
          <>
            <span className="sr-only">:</span>{' '}
            <span className="min-w-0 truncate text-text-2 group-hover/status:text-text-1">
              {says}
            </span>
          </>
        )}
      </a>
    </div>
  );
}

function AppHeader({
  name = 'JagHelm',
  logoUrl,
  homeHref = '/',
  status,
  updated,
  onOpenPalette,
  shortcut = '⌘K',
  settingsHref = '/settings',
  settingsCurrent = false,
  onLogout,
  onNavigate,
  className,
  ...props
}) {
  const link = (href) => (onNavigate ? (e) => onNavigate(e, href) : undefined);
  return (
    <header
      data-slot="app-header"
      className={cn(
        'flex h-12 items-center gap-3 border-b border-border bg-background px-4 md:gap-4 md:px-6',
        className
      )}
      {...props}
    >
      <a
        href={homeHref}
        onClick={link(homeHref)}
        className="flex shrink-0 items-center gap-2.5 rounded-md"
      >
        {logoUrl ? (
          <img src={logoUrl} alt="" className="size-7 shrink-0 rounded-lg object-contain" />
        ) : (
          <HelmMark />
        )}
        <span className="max-w-48 truncate text-title-xs font-extrabold max-md:sr-only">
          {name}
        </span>
      </a>
      <HeaderStatus status={status} onNavigate={onNavigate} />
      {updated && <div className="hidden shrink-0 sm:block">{updated}</div>}
      {onOpenPalette && (
        <>
          <button
            type="button"
            onClick={onOpenPalette}
            aria-keyshortcuts="Meta+K Control+K"
            className="hidden h-control w-60 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface-1 pr-2 pl-3 text-body-sm text-text-3 shadow-control transition-colors hover:border-border-strong hover:bg-surface-2 lg:flex xl:w-70"
          >
            <Search aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0" />
            <span className="flex-1 truncate text-left">Search or jump to…</span>
            <kbd className="rounded-sm border border-border-strong px-1.5 font-mono text-overline font-medium text-text-2">
              {shortcut}
            </kbd>
          </button>
          <Tooltip content="Search or jump to">
            <IconButton
              label="Search or jump to"
              onClick={onOpenPalette}
              aria-keyshortcuts="Meta+K Control+K"
              className="lg:hidden"
            >
              <Search aria-hidden="true" />
            </IconButton>
          </Tooltip>
        </>
      )}
      <Tooltip content="Settings">
        <a
          href={settingsHref}
          aria-label="Settings"
          aria-current={settingsCurrent ? 'page' : undefined}
          onClick={link(settingsHref)}
          className={cn(
            buttonVariants({ variant: 'ghost' }),
            'size-control shrink-0 px-0',
            settingsCurrent && 'bg-accent-tint text-accent-text'
          )}
        >
          <SlidersHorizontal aria-hidden="true" />
        </a>
      </Tooltip>
      {onLogout && (
        <Tooltip content="Log out">
          <IconButton label="Log out" onClick={onLogout} className="shrink-0">
            <LogOut aria-hidden="true" />
          </IconButton>
        </Tooltip>
      )}
    </header>
  );
}

export { AppHeader, HelmMark, UpdatedAgo };
