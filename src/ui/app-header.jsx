/*
 * AppHeader (spec §5.4, §7; #296, #275): the annunciator header, 48px tall and
 * the full width of the window, above every page. Left to right:
 *
 *   brand      the logo and the instance name, a link to the Overview:
 *              JagHelm's shield (public/logo.svg, the favicon's artwork, #530),
 *              or `logoUrl` when one is set, 28px square. Below 768px the name
 *              is for screen readers only.
 *   status     the overall state from the status model: its lamp, its word
 *              and the model's sentence, which carries the counts ("2 services
 *              down · 1 no signal"), the whole of it a link to Alerts. Healthy
 *              (ok, or only maintenance) says "All systems normal" in text-1,
 *              never in green (rule 3). An empty board (`EMPTY`, nothing set
 *              up, #449) is quiet too, with no lamp: the model's sentence,
 *              "Nothing monitored yet", in text-1, never "No signal" and never
 *              "All systems normal". `reach` other than 'ok' is no signal:
 *              the steel ring and "No signal", the same word and colour as
 *              the Android app, then `lastKnown` when the shell has a last
 *              status ("last known 3 min ago: All systems normal", #480),
 *              else why ("Can't reach JagHelm"; NO_SIGNAL's keys: 'down',
 *              'waiting', 'expired'). Nothing from the last status is drawn
 *              in its colour.
 *              `reach` 'loading', before the first answer, is a placeholder,
 *              neither a state nor no signal.
 *              Beside the link, a live region (sr-only) announces a change
 *              of state, never a tick of an age: the link's words while
 *              there is a signal ("Critical: 1 service down"), else "No
 *              signal" and why ("No signal: Can't reach JagHelm"), without
 *              `lastKnown`, whose age moves each second.
 *   updated    "Updated 12 s ago" (UpdatedAgo): its own component with its own
 *              clock, so its tick each second re-renders nothing else. From
 *              640px.
 *   search     opens the command palette; from 1024px the mock's wide button
 *              with the shortcut, narrower an icon, leaving the sentence room.
 *   theme      with `onThemeChange`, the mock's toggle (#304): a sun in dark,
 *              "Switch to light theme", a moon in light, "Switch to dark
 *              theme". It reads the theme of the UiRoot it is drawn in and
 *              calls `onThemeChange('light')` or `('dark')`; system is
 *              Settings → Appearance's.
 *   settings   a link to Settings.
 *   logout     Log out, when the server asks for a sign-in.
 *
 * `onNavigate(event, href)` handles a link's click (the router's followLink),
 * so a modified click still opens a new browser tab.
 */
import { useContext } from 'react';
import { LogOut, Moon, Search, SlidersHorizontal, Sun } from 'lucide-react';
import { buttonVariants } from './button.jsx';
import { IconButton } from './icon-button.jsx';
import { Skeleton } from './skeleton.jsx';
import { StatusLamp } from './status-lamp.jsx';
import { StatusWord } from './status-word.jsx';
import { Tooltip } from './tooltip.jsx';
import { cn } from './lib/utils.js';
import { agoText, useAgo } from './lib/ago.js';
import { RootSwitchesContext, SWITCHES } from './lib/portal.js';
import { EMPTY, EMPTY_SENTENCE, NO_SIGNAL, WORDS, toState } from './lib/status.js';

/**
 * The overall states that read as quiet: maintenance never breaks the quiet
 * line (§6.1), and an empty board has nothing to break it (#449).
 */
const QUIET = new Set(['ok', 'maintenance', EMPTY]);

/** JagHelm's own mark, the shield (#530): the header's logo unless `logoUrl` is set. */
const SHIELD = '/logo.svg';

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

/**
 * The header's live region: what it says is announced when it changes. One
 * element for the placeholder and the status, so the first status after the
 * placeholder is announced as a change.
 */
function Announce({ busy, children }) {
  return (
    <span role="status" aria-busy={busy || undefined} className="sr-only">
      {children}
    </span>
  );
}

function HeaderStatus({ status = {}, onNavigate }) {
  const { reach = 'ok', state, word, sentence, href = '/alerts', current, lastKnown } = status;
  if (reach === 'loading') {
    // Before the first answer: no state to show yet, and not "No signal" either.
    return (
      <div data-slot="header-status" className="flex min-w-0 flex-1 items-center gap-2.5">
        <Skeleton key="lamp" className="size-3.5 rounded-full" />
        <Skeleton key="line" className="h-3 w-40 max-w-full" />
        <Announce key="announce" busy>
          Checking status
        </Announce>
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
  // Without a signal, why: what the live region says, and the line when
  // nothing is known.
  const why = !signal ? NO_SIGNAL[reach] || NO_SIGNAL.down : null;
  // An empty board's sentence is its whole line, said once. Without a signal,
  // what was last known, or else why.
  const says = !signal ? lastKnown || why : sentence !== said ? sentence : null;
  // Never the last known line: its age moves each second.
  const announced = !signal ? `${said}: ${why}` : says ? `${said}: ${says}` : said;
  return (
    <div data-slot="header-status" className="flex min-w-0 flex-1">
      <a
        key="link"
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
      <Announce key="announce">{announced}</Announce>
    </div>
  );
}

/**
 * The theme toggle: to light from dark, to dark from light, by the theme of
 * the UiRoot it is drawn in (none: dark, the default).
 */
function ThemeToggle({ onThemeChange }) {
  const light = useContext(RootSwitchesContext)?.[SWITCHES.theme.attribute] === 'light';
  const label = light ? 'Switch to dark theme' : 'Switch to light theme';
  return (
    <Tooltip content={label}>
      <IconButton
        label={label}
        onClick={() => onThemeChange(light ? 'dark' : 'light')}
        className="shrink-0"
      >
        {light ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
      </IconButton>
    </Tooltip>
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
  onThemeChange,
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
        <img
          src={logoUrl || SHIELD}
          alt=""
          width={28}
          height={28}
          className={cn('size-7 shrink-0 object-contain', logoUrl && 'rounded-lg')}
        />
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
      {onThemeChange && <ThemeToggle onThemeChange={onThemeChange} />}
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

export { AppHeader, UpdatedAgo, NO_SIGNAL, agoText, useAgo };
