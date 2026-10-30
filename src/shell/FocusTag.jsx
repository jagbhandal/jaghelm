import { ChartFocusTag } from '@ui/monitoring-section';
import { drawnState, useStatusFreshness } from './statusFreshness.js';

/**
 * The tag in a focused chart's header: the issue's lamp, word and reason, so
 * the focus isn't colour alone. A stale status is drawn as no signal
 * (statusFreshness.js). Mounted only with an issue, so only then does it ask.
 */
export function FocusTag({ issue, status, reach, updated }) {
  const freshness = useStatusFreshness({ status, reach, updated });
  return (
    <ChartFocusTag state={drawnState(issue.state, freshness)}>
      {issue.word} · {issue.reason}
    </ChartFocusTag>
  );
}
