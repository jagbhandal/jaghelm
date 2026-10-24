/*
 * IssueRow (spec §5.4, §6; #287): one issue in a list, such as the attention
 * panel's: its lamp, its word, what it is, where, why, and since when.
 *
 * `issue` is `{ state, word, title, where, reason, age }`. A row that opens
 * something is a link (`href`) or a button (`onOpen`, called with no
 * argument: the caller knows where it leads), named "title, word, where" and
 * described by its reason and age; a row with nothing to open is plain
 * content, so it neither looks nor announces as tappable (#279). A link may
 * have an `onOpen` too, when the page opens it itself (an entity's URL, #309,
 * opens its detail over the page): a plain click or Enter calls it instead
 * of loading the link, and a click with a modifier key or the middle button
 * is the browser's alone (the link in a new tab or window), so it never
 * moves this one.
 *
 * The row is the mock's, at either of its own widths:
 *
 *  - from 672px (`@2xl`), the desktop attention panel's: lamp, word, the
 *    title over where, the reason, the age and a chevron, in columns, 48px
 *    tall at least;
 *  - narrower, the phone's: the lamp, "title · word" over the reason, and the
 *    age, 56px tall at least.
 *
 * The lamp is decorative: the word beside it names the status. Drawn as no
 * signal beside another word (a stale status's last known "Down", #480), it
 * is named "No signal" (lampName), and the row's name says it before the
 * word: "title, No signal, word, where".
 */
import { useId } from 'react';
import { ChevronRight } from 'lucide-react';
import { StatusLamp } from './status-lamp.jsx';
import { cn } from './lib/utils.js';
import { openHere } from './lib/link.js';
import { WORDS, lampName, spoken, toState } from './lib/status.js';

const word = {
  ok: 'text-ok-fg',
  warn: 'text-warn-fg',
  crit: 'text-crit-fg',
  unknown: 'text-unknown-fg',
  maintenance: 'text-maintenance-fg',
};

/**
 * The name of a row that opens something: "title, word, where", with the
 * lamp's name before the word when the word doesn't say it (`lamp`).
 */
function nameOf(title, said, where, lamp) {
  return [title, lamp, spoken(said), where].filter(Boolean).join(', ');
}

function IssueRow({ issue, incident, onOpen, href, className, ...props }) {
  const it = issue ?? incident ?? {};
  const id = useId();
  const s = toState(it.state ?? it.severity);
  const said = it.word || WORDS[s];
  // The lamp's own name, where the word beside it doesn't say what it draws.
  const lamp = lampName(s, said) === said ? null : lampName(s, said);
  const opens = Boolean(href || onOpen);
  const Tag = href ? 'a' : onOpen ? 'button' : 'div';
  const described = [it.reason && `${id}-reason`, it.age && `${id}-age`].filter(Boolean);
  const action =
    Tag === 'button'
      ? { type: 'button', onClick: () => onOpen() }
      : Tag === 'a'
        ? { href, onClick: onOpen ? (e) => openHere(e, onOpen) : undefined }
        : {};

  return (
    <Tag
      data-slot="issue-row"
      data-state={s}
      aria-label={opens ? nameOf(it.title, said, it.where, lamp) : undefined}
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
        <StatusLamp
          state={s}
          label={lamp ?? undefined}
          decorative={!lamp}
          className="mt-1.25 @2xl:mt-0"
        />
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
