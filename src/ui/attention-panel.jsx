/*
 * AttentionPanel (spec §5.4, §6; #287): the overall state, in a sentence, and
 * the issues that need attention, worst first. It grows out of the Android
 * app's SystemStatusCard.
 *
 *   state     the overall state (or the Android app's `severity`)
 *   word      the status word ("Critical"); its state's word by default, and
 *             "All systems normal" when quiet
 *   counts    the counts after it ("2 critical, 2 warnings, 1 no signal")
 *   subline   one sentence naming what is wrong
 *   action    an element at the top right, such as a link to all alerts
 *   issues    the IssueRow `issue`s, each with its own `id`, and `onOpen`
 *             or `href` to open it
 *   filter, onClearFilter   the subsystem the list is filtered to, and Clear
 *             (the quiet line says it too: the board under it is filtered)
 *   meta      the quiet line's caption ("Last incident 2 d ago")
 *   titleAs   the heading's element: h1, as the Overview's own heading
 *   between   an element that follows the panel's header (the Overview's
 *             subsystem strip, #484): right after the panel, or with
 *             `split`, between its header and its rows
 *   split     the panel in two parts with `between` between them, as the
 *             Phone board orders it (status card, strip, issue list): the
 *             Overview below 768px (#484)
 *
 * The `ui` look is the mock's. With issues, or any state but ok and
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
 * `split` (#484) changes the frame, nothing else: one region, its header
 * (lamp, heading, sentence, action) in one card, then `between`, then a card
 * with the rows, headed by "Showing … only" when filtered, so the page reads
 * and takes the focus in that order (header, strip, rows). With no rows and
 * nothing filtered there is no second card. The quiet line has no rows to
 * split: `between` follows it either way. Unsplit, the panel is one card, as
 * the desktop draws it, and `between` follows it.
 *
 * The `android` look, a stopgap until #326, is the Android app's
 * SystemStatusCard, unchanged (lib/status.js): the "System status" label,
 * `headline` with `word` coloured where it appears in it, `subline` and the
 * `counts` footer.
 */
import { Button } from './button.jsx';
import { IssueRow } from './issue-row.jsx';
import { StatusLamp } from './status-lamp.jsx';
import { StatusWord } from './status-word.jsx';
import { cn } from './lib/utils.js';
import { EMPTY, EMPTY_SENTENCE, toSeverity, toState } from './lib/status.js';

const ANDROID_COLOURS = {
  critical: 'var(--red)',
  caution: 'var(--amber)',
  healthy: 'var(--green)',
  unknown: 'var(--steel)',
};

function AndroidSystemStatusCard({ state, severity: given, headline, word, subline, counts }) {
  const severity = toSeverity(state ?? given);
  const color = ANDROID_COLOURS[severity] ?? 'var(--steel)';
  // The headline around the first case-insensitive `word` in it, which is
  // coloured; a headline without it renders as it is.
  let parts = null;
  if (word && headline) {
    const idx = headline.toLowerCase().indexOf(word.toLowerCase());
    if (idx !== -1) {
      parts = {
        before: headline.slice(0, idx),
        match: headline.slice(idx, idx + word.length),
        after: headline.slice(idx + word.length),
      };
    }
  }
  return (
    <div className={`sys-status-card sys-status-card--${severity}`}>
      <p className="sys-status-card__label">System status</p>
      <p className="sys-status-card__headline">
        {parts ? (
          <>
            {parts.before}
            <span
              className={`sys-status-card__word sys-status-card__word--${severity}`}
              style={{ color }}
            >
              {parts.match}
            </span>
            {parts.after}
          </>
        ) : (
          headline
        )}
      </p>
      <p className="sys-status-card__subline">{subline}</p>
      <p className="sys-status-card__counts">{counts}</p>
    </div>
  );
}

function AttentionPanel(props) {
  if (__ANDROID_LOOK__) {
    const { between, split: _split, ...card } = props;
    return (
      <>
        <AndroidSystemStatusCard {...card} />
        {between}
      </>
    );
  }
  return <UiAttentionPanel {...props} />;
}

function UiAttentionPanel({
  state,
  severity,
  word,
  headline: _headline, // the Android look's sentence
  counts,
  subline,
  action,
  issues = [],
  filter,
  onClearFilter,
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

  if (quiet) {
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

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-4 px-panel pt-panel pb-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-center gap-3">
          <StatusLamp state={s} size="lg" decorative />
          <Title className="text-headline">
            <StatusWord state={s} word={word} />
            {counts && <span className="font-semibold text-text-2"> · {counts}</span>}
          </Title>
        </div>
        {subline && <p className="max-w-[72ch] text-text-2">{subline}</p>}
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
          Nothing in {filter} needs attention
        </p>
      )}
    </>
  );
  const card = 'rounded-xl border border-border bg-surface-1';

  if (split) {
    return (
      <section
        data-slot="attention-panel"
        data-state={s}
        data-layout="split"
        aria-label="Needs attention"
        className={cn('flex flex-col gap-6 text-text-1', className)}
        {...props}
      >
        <div data-slot="attention-panel-header" className={card}>
          {header}
        </div>
        {between}
        {rows && (
          <div data-slot="attention-panel-rows" className={cn('overflow-hidden', card)}>
            {rows}
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
