/*
 * AttentionPanel (spec §5.4, §6; #287): the overall state, in a sentence, and
 * the issues that need attention, worst first.
 *
 *   state     the overall state (or `severity`, the old name for it)
 *   word      the status word ("Critical"); its state's word by default, and
 *             "All systems normal" when quiet
 *   counts    the counts after it ("2 critical, 2 warnings, 1 no signal")
 *   subline   one sentence naming what is wrong
 *   action    an element at the top right, such as a link to all alerts
 *   issues    the IssueRow `issue`s, each with its own `id`, and `onOpen`
 *             or `href` to open it
 *   filter, onClearFilter   the subsystem the list is filtered to, and Clear
 *             (the quiet line says it too: the board under it is filtered);
 *             or what the Alerts page's filters show ("critical alerts on
 *             services", #314)
 *   noMatch   what the rows say when filtering leaves none ("Nothing in
 *             Jobs needs attention" by default)
 *   meta      the quiet line's caption ("Last incident 2 d ago"); split, the
 *             header's last line ("Updated 12 s ago"), quiet or not
 *   titleAs   the heading's element: h1, as the Overview's own heading
 *   between   an element that follows the panel's header (the Overview's
 *             subsystem strip, #484): right after the panel, or with
 *             `split`, between its header and its rows
 *   split     the panel in two parts with `between` between them, as the
 *             Phone board orders it (status card, strip, issue list): the
 *             phone's Overview, below 768px (#484, #303). The rows get the
 *             board's label, "Needs attention · 6", a heading a level under
 *             the panel's
 *
 * The panel is the mock's. With issues, or any state but ok and
 * maintenance (which never make an issue, spec §6.1), it is the attention
 * panel: a 14px lamp and the word in its colour, the counts after it in
 * `text-2`, the sentence under them, then the list of IssueRows; filtered to a
 * subsystem with none, one quiet line says so. Otherwise it is the mock's
 * quiet line: a lamp, "All systems normal" in `text-1`, the counts, and
 * `meta`; with a filter, "Showing … only" and Clear at its end (#298), as
 * the board under it is filtered. Healthy stays quiet (rule 3): no green word. Maintenance doesn't
 * break the quiet line either (§6.1): the heading still says all is normal,
 * the lamp is the wrench, and the strip's tile under the line says what is in
 * maintenance. An empty board (`EMPTY`: nothing is set up, #449) is the quiet
 * line too, with no lamp, since it has no state to show: its heading is
 * `word`, or else the sentence it is given in `counts` (the model's "Nothing
 * monitored yet"), said once. Never "All systems normal": nobody checked.
 *
 * `split` (#484) changes the frame and the header's type: one region, its header
 * (lamp, heading, sentence, action, `meta`) in one card, then `between`,
 * then a card with the rows, headed by "Showing … only" when filtered, so the
 * page reads and takes the focus in that order (header, strip, rows). Over
 * that card, the Phone board's label, "Needs attention · 6" (the rows it
 * lists; no count when the subsystem shown has none), a heading a level
 * under the panel's, so heading navigation reaches the rows after the strip.
 * With no rows and nothing filtered there is no second card. Quiet, split is
 * the Phone board's healthy card (#303): the same header card, its heading
 * "All systems normal" (an empty board's sentence, without a lamp), the
 * model's sentence under it, then `between`. Unsplit, the panel is one card,
 * as the desktop draws it, and `between` follows it; quiet, it is the line.
 * Split, the header is the Phone board's status card: 16px in, a 16px lamp,
 * the heading 22/28 at 800 (`title-lg`); the phone's Overview gives it the
 * word alone, the sentence under it, as the mock's.
 */
import { Button } from './button.jsx';
import { IssueRow } from './issue-row.jsx';
import { StatusLamp } from './status-lamp.jsx';
import { StatusWord } from './status-word.jsx';
import { cn } from './lib/utils.js';
import { EMPTY, EMPTY_SENTENCE, toState } from './lib/status.js';

function AttentionPanel({
  state,
  severity,
  word,
  headline: _headline, // ignored: the panel builds its sentence from `word`, `counts` and `subline`
  counts,
  subline,
  action,
  issues = [],
  filter,
  onClearFilter,
  noMatch,
  meta,
  titleAs = 'h1',
  between,
  split = false,
  className,
  ...props
}) {
  // An empty board has no issues; one that somehow does is drawn as no signal.
  const empty = (state ?? severity) === EMPTY && issues.length === 0;
  const s = empty ? EMPTY : toState(state ?? severity);
  const quiet = issues.length === 0 && (empty || s === 'ok' || s === 'maintenance');
  const Title = titleAs;

  if (quiet && !split) {
    const said = word || (empty ? counts || EMPTY_SENTENCE : 'All systems normal');
    const filtered = Boolean(filter);
    return (
      <>
        <section
          data-slot="attention-panel"
          data-state={s}
          aria-label="Status"
          className={cn(
            'flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-1 px-panel py-3.5 text-text-1',
            className
          )}
          {...props}
        >
          {/* The heading beside it says the state, so the lamp is its shape only. */}
          {!empty && <StatusLamp state={s} decorative />}
          <Title className="text-title-xs">{said}</Title>
          {counts && counts !== said && <span className="text-text-2">{counts}</span>}
          {filtered && (
            <span className="ml-auto flex items-center gap-2 text-body-sm text-text-2">
              <span>Showing {filter} only</span>
              {onClearFilter && (
                <Button variant="ghost" size="sm" tone="accent" onClick={onClearFilter}>
                  Clear
                </Button>
              )}
            </span>
          )}
          {meta && (
            <span className={cn('text-caption text-text-3', !filtered && 'ml-auto')}>{meta}</span>
          )}
        </section>
        {between}
      </>
    );
  }

  // Quiet (split only), the healthy card's heading and the sentence under it.
  const quietSaid = word || (empty ? counts || EMPTY_SENTENCE : 'All systems normal');
  const line = quiet ? (counts && counts !== quietSaid ? counts : null) : subline;
  // Split, the Phone board's status card: 16px in, a 16px lamp 10px from
  // the word, 22/28 at 800 (title-lg), as its sheets' titles (#303).
  const heading = split ? 'text-title-lg' : 'text-headline';
  const header = (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-4',
        split ? 'p-4' : 'px-panel pt-panel pb-4'
      )}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className={cn('flex items-center', split ? 'gap-2.5' : 'gap-3')}>
          {!empty && <StatusLamp state={s} size={split ? 16 : 'lg'} decorative />}
          {quiet ? (
            <Title className={heading}>{quietSaid}</Title>
          ) : (
            <Title className={heading}>
              <StatusWord state={s} word={word} className={split ? 'font-extrabold' : undefined} />
              {counts && <span className="font-semibold text-text-2"> · {counts}</span>}
            </Title>
          )}
        </div>
        {line && <p className="max-w-[72ch] text-text-2">{line}</p>}
        {split && meta && <p className="text-caption text-text-3">{meta}</p>}
      </div>
      {action && (
        <div className="pt-1.5 text-body-sm font-semibold whitespace-nowrap">{action}</div>
      )}
    </div>
  );
  // Split, "Showing … only" heads the rows' own card.
  const rows = (Boolean(filter) || issues.length > 0) && (
    <>
      {filter && (
        <div
          className={cn(
            'flex items-center gap-2 px-panel pb-3 text-body-sm text-text-2',
            split && 'pt-3'
          )}
        >
          <span>Showing {filter} only</span>
          {onClearFilter && (
            <Button variant="ghost" size="sm" tone="accent" onClick={onClearFilter}>
              Clear
            </Button>
          )}
        </div>
      )}
      {issues.length > 0 && (
        <ul
          className={cn(
            'divide-y divide-border',
            (!split || Boolean(filter)) && 'border-t border-border'
          )}
        >
          {issues.map((issue, i) => (
            <li key={issue.id ?? i}>
              <IssueRow issue={issue} onOpen={issue.onOpen} href={issue.href} />
            </li>
          ))}
        </ul>
      )}
      {filter && issues.length === 0 && (
        <p className="border-t border-border px-panel py-3 text-body-sm text-text-3">
          {noMatch ?? <>Nothing in {filter} needs attention</>}
        </p>
      )}
    </>
  );
  const card = 'rounded-xl border border-border bg-surface-1';

  if (split) {
    // A level under the panel's heading: h3 under the Overview's h2.
    const level = /^h[1-5]$/.test(titleAs) ? Number(titleAs[1]) + 1 : 6;
    const RowsTitle = `h${level}`;
    return (
      <section
        data-slot="attention-panel"
        data-state={s}
        data-layout="split"
        aria-label={quiet ? 'Status' : 'Needs attention'}
        className={cn('flex flex-col gap-6 text-text-1', className)}
        {...props}
      >
        <div data-slot="attention-panel-header" className={card}>
          {header}
        </div>
        {between}
        {rows && (
          <div className="flex flex-col gap-2">
            <RowsTitle className="text-overline text-text-3 uppercase">
              Needs attention{issues.length > 0 && ` · ${issues.length}`}
            </RowsTitle>
            <div data-slot="attention-panel-rows" className={cn('overflow-hidden', card)}>
              {rows}
            </div>
          </div>
        )}
      </section>
    );
  }

  return (
    <>
      <section
        data-slot="attention-panel"
        data-state={s}
        aria-label="Needs attention"
        className={cn('overflow-hidden text-text-1', card, className)}
        {...props}
      >
        {header}
        {rows}
      </section>
      {between}
    </>
  );
}

export { AttentionPanel };
