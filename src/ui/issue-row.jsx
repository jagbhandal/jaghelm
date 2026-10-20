/*
 * IssueRow (spec §5.4, §6; #287): one issue in a list, such as the attention
 * panel's: its lamp, its word, what it is, where, why, and since when.
 *
 * `issue` is `{ state, word, title, where, reason, age }` (the Android app's
 * `incident` from deriveIncidents() is read too, below). A row that opens
 * something is a link (`href`) or a button (`onOpen`, called with no
 * argument: the caller knows where it leads), named "title, word, where" and
 * described by its reason and age; a row with nothing to open is plain
 * content, so it neither looks nor announces as tappable (#279). A link may
 * have an `onOpen` too, for what the page does beside following it (the
 * Overview's moves to the place it names, #297): a plain click or Enter
 * calls it, and a click with a modifier key or the middle button is the
 * browser's alone (a new tab or window), so it never moves this one.
 *
 * The `ui` look is the mock's row, at either of its own widths:
 *
 *  - from 672px (`@2xl`), the desktop attention panel's: lamp, word, the
 *    title over where, the reason, the age and a chevron, in columns, 48px
 *    tall at least;
 *  - narrower, the phone's: the lamp, "title · word" over the reason, and the
 *    age, 56px tall at least.
 *
 * The lamp is decorative: the word beside it names the status.
 *
 * The `android` look, a stopgap until #326, is the Android app's row,
 * unchanged (lib/status.js): it reads `readout` (passed through verbatim, never
 * a made-up age) and shows `cause` only on a critical row; MobileApp.css
 * styles it.
 */
import { useId } from 'react';
import { ChevronRight } from 'lucide-react';
import { StatusLamp } from './status-lamp.jsx';
import { StatusWord } from './status-word.jsx';
import { cn } from './lib/utils.js';
import { WORDS, spoken, toSeverity, toState } from './lib/status.js';

const word = {
  ok: 'text-ok-fg',
  warn: 'text-warn-fg',
  crit: 'text-crit-fg',
  unknown: 'text-unknown-fg',
  maintenance: 'text-maintenance-fg',
};

/** A click the page may act on: the main button, no modifier key. */
const plain = (e) => e.button === 0 && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey);

/** The name of a row that opens something: "title, word, where". */
function nameOf(title, said, where) {
  return [title, spoken(said), where].filter(Boolean).join(', ');
}

function AndroidIssueRow({ incident, onOpen }) {
  const severity = toSeverity(incident.state ?? incident.severity);
  const showCause = severity === 'critical' && Boolean(incident.cause);
  const className = `issue-row issue-row--${severity}`;

  const content = (
    <>
      <div className="issue-row__main">
        <StatusLamp shape={incident.shape} severity={severity} label={incident.word} size={14} />
        <StatusWord word={incident.word} severity={severity} />
        <span className="issue-row__name">{incident.title}</span>
        <span className="issue-row__readout">{incident.readout}</span>
      </div>

      {/* Prose cause — only for critical/down rows */}
      {showCause && <p className="issue-row__cause">{incident.cause}</p>}
    </>
  );

  if (!onOpen) return <div className={className}>{content}</div>;

  // One clean name instead of the lamp label + word + text run together.
  return (
    <button
      type="button"
      className={className}
      onClick={() => onOpen()}
      aria-label={nameOf(incident.title, incident.word, incident.readout)}
    >
      {content}
    </button>
  );
}

function IssueRow({ issue, incident, ...props }) {
  const it = issue ?? incident ?? {};
  if (__ANDROID_LOOK__) return <AndroidIssueRow incident={it} onOpen={props.onOpen} />;
  return <UiIssueRow issue={it} {...props} />;
}

function UiIssueRow({ issue: it, onOpen, href, className, ...props }) {
  const id = useId();
  const s = toState(it.state ?? it.severity);
  const said = it.word || WORDS[s];
  const opens = Boolean(href || onOpen);
  const Tag = href ? 'a' : onOpen ? 'button' : 'div';
  const described = [it.reason && `${id}-reason`, it.age && `${id}-age`].filter(Boolean);
  const action =
    Tag === 'button'
      ? { type: 'button', onClick: () => onOpen() }
      : Tag === 'a'
        ? { href, onClick: onOpen ? (e) => plain(e) && onOpen() : undefined }
        : {};

  return (
    <Tag
      data-slot="issue-row"
      data-state={s}
      aria-label={opens ? nameOf(it.title, said, it.where) : undefined}
      aria-describedby={opens && described.length ? described.join(' ') : undefined}
      className={cn(
        '@container block w-full text-left text-text-1',
        opens && 'cursor-pointer -outline-offset-2 transition-colors hover:bg-row-hover',
        className
      )}
      {...action}
      {...props}
    >
      <span className="grid min-h-14 grid-cols-[12px_minmax(0,1fr)_auto] items-start gap-x-3 px-3.5 py-2.5 @2xl:min-h-12 @2xl:grid-cols-[18px_96px_minmax(140px,1.1fr)_minmax(200px,2fr)_44px_16px] @2xl:items-center @2xl:px-panel @2xl:py-2">
        <StatusLamp state={s} decorative className="mt-1.25 @2xl:mt-0" />
        <span className="flex min-w-0 flex-col @2xl:contents">
          <span className="flex min-w-0 items-baseline gap-1 @2xl:contents">
            <span className="flex min-w-0 flex-col @2xl:col-start-3 @2xl:row-start-1">
              <span className="truncate font-bold @2xl:font-semibold">{it.title}</span>
              {it.where && (
                <span className="hidden truncate text-caption leading-5 text-text-3 @2xl:block">
                  {it.where}
                </span>
              )}
            </span>
            <span
              className={cn(
                'shrink-0 font-bold @2xl:col-start-2 @2xl:row-start-1 @2xl:text-body-sm',
                word[s]
              )}
            >
              <span aria-hidden="true" className="@2xl:hidden">
                ·{' '}
              </span>
              {said}
            </span>
          </span>
          {it.reason && (
            <span
              id={`${id}-reason`}
              className="text-body-sm leading-5 text-text-2 @2xl:col-start-4 @2xl:row-start-1 @2xl:text-body"
            >
              {it.reason}
            </span>
          )}
        </span>
        {it.age && (
          <span
            id={`${id}-age`}
            className="pt-px text-caption whitespace-nowrap text-text-3 @2xl:col-start-5 @2xl:row-start-1 @2xl:pt-0 @2xl:text-right"
          >
            {it.age}
          </span>
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

export { IssueRow };
