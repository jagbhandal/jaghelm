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
 *   meta      the quiet line's caption ("Last incident 2 d ago")
 *   titleAs   the heading's element: h1, as the Overview's own heading
 *
 * The `ui` look is the mock's. With issues, or any state but ok and
 * maintenance (which never make an issue, spec §6.1), it is the attention
 * panel: a 14px lamp and the word in its colour, the counts after it in
 * `text-2`, the sentence under them, then the list of IssueRows. Otherwise it
 * is the mock's quiet line: a lamp, "All systems normal" in `text-1`, the
 * counts, and `meta`. Healthy stays quiet (rule 3): no green word.
 *
 * The `android` look is the Android app's SystemStatusCard, unchanged
 * (lib/status.js): the "System status" label, `headline` with `word` coloured
 * where it appears in it, `subline` and the `counts` footer.
 */
import { Button } from './button.jsx';
import { IssueRow } from './issue-row.jsx';
import { StatusLamp } from './status-lamp.jsx';
import { StatusWord } from './status-word.jsx';
import { cn } from './lib/utils.js';
import { DEFAULT_LOOK, WORDS, toSeverity, toState } from './lib/status.js';

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

function AttentionPanel({ look, ...props }) {
  if (DEFAULT_LOOK === 'android' || look === 'android')
    return <AndroidSystemStatusCard {...props} />;
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
  className,
  ...props
}) {
  const s = toState(state ?? severity);
  const quiet = issues.length === 0 && (s === 'ok' || s === 'maintenance');
  const Title = titleAs;

  if (quiet) {
    const said = word || (s === 'ok' ? 'All systems normal' : WORDS[s]);
    return (
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
        <StatusLamp state={s} label={said} look="ui" />
        <Title className="text-title-xs">{said}</Title>
        {counts && <span className="text-text-2">{counts}</span>}
        {meta && <span className="ml-auto text-caption text-text-3">{meta}</span>}
      </section>
    );
  }

  return (
    <section
      data-slot="attention-panel"
      data-state={s}
      aria-label="Needs attention"
      className={cn(
        'overflow-hidden rounded-xl border border-border bg-surface-1 text-text-1',
        className
      )}
      {...props}
    >
      <div className="flex flex-wrap items-start justify-between gap-4 px-panel pt-panel pb-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center gap-3">
            <StatusLamp state={s} size="lg" decorative look="ui" />
            <Title className="text-headline">
              <StatusWord state={s} word={word} look="ui" />
              {counts && <span className="font-semibold text-text-2"> · {counts}</span>}
            </Title>
          </div>
          {subline && <p className="max-w-[72ch] text-text-2">{subline}</p>}
        </div>
        {action && (
          <div className="pt-1.5 text-body-sm font-semibold whitespace-nowrap">{action}</div>
        )}
      </div>
      {filter && (
        <div className="flex items-center gap-2 px-panel pb-3 text-body-sm text-text-2">
          <span>Showing {filter} only</span>
          {onClearFilter && (
            <Button variant="ghost" size="sm" tone="accent" onClick={onClearFilter}>
              Clear
            </Button>
          )}
        </div>
      )}
      {issues.length > 0 && (
        <ul className="divide-y divide-border border-t border-border">
          {issues.map((issue, i) => (
            <li key={issue.id ?? i}>
              <IssueRow issue={issue} onOpen={issue.onOpen} href={issue.href} look="ui" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export { AttentionPanel };
