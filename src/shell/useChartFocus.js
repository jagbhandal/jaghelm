/**
 * The Monitoring page's chart focus (#752, spec §4): `/monitoring?focus=<id>`
 * scrolls to that chart under the header, moves keyboard focus to it, rings it
 * in the selected colour (violet means selected, never status) with a text
 * tag of the issue (lamp, word and reason: "Warning · Disk 91% full"), and
 * says so in a live region. The ring clears on the next press anywhere or
 * Escape, and takes `focus` off the address (replaced, not pushed), so a
 * reload doesn't ring it again and the same link works again.
 *
 * A chart that isn't drawn (not built yet, or a failed read of the page) is
 * quiet: no ring, no error. It is looked for again as the answers come, until
 * found, and focused once per address: the page's refreshes don't scroll it
 * back. Reduced motion scrolls at once.
 *
 * Returns `{ active, issueOf, announce }`: the focused chart's id (or null),
 * a function from a chart id to the status issue it is focused for (or
 * undefined), and the live region's text.
 */
import { useEffect, useRef, useState } from 'react';
import { FOCUS_PARAM, chartOfIssue } from '../../server/monitoringFocus.js';
import { navigate, useSearchParam } from '../router/useRoute.js';

const reduced = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The address without `focus`. */
function withoutFocus() {
  const params = new URLSearchParams(window.location.search);
  params.delete(FOCUS_PARAM);
  const rest = params.toString();
  return `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`;
}

/**
 * @param {{ loaded: boolean, status?: any, charts: Record<string, string> }} input
 *   `loaded`: the page's charts are drawn (their answer is in); `charts`:
 *   chart id -> its title, for the announcement
 */
export function useChartFocus({ loaded, status, charts }) {
  const param = useSearchParam(FOCUS_PARAM);
  const [active, setActive] = useState(null);
  const [announce, setAnnounce] = useState('');
  // The address already focused, so a refresh of the charts doesn't scroll again.
  const done = useRef(null);

  const issue = param ? status?.issues?.find((i) => chartOfIssue(i) === param) : undefined;
  const said = issue ? `${issue.word}, ${issue.reason}` : '';

  useEffect(() => {
    if (!param) {
      done.current = null;
      setActive(null);
      return;
    }
    if (!loaded || done.current === param) return;
    const el = Array.from(document.querySelectorAll('[data-slot="monitoring-chart"]')).find(
      (e) => e.getAttribute('data-chart') === param
    );
    if (!el) {
      setActive(null);
      return;
    }
    done.current = param;
    setActive(param);
    el.scrollIntoView?.({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
    el.focus?.({ preventScroll: true });
  }, [param, loaded]);

  // The announcement follows the ring (and the issue, once the status is in).
  useEffect(() => {
    setAnnounce(active ? [charts[active] ?? active, said].filter(Boolean).join(': ') : '');
  }, [active, said, charts]);

  // The next press anywhere, or Escape, clears it. A press (not a click) so a
  // View graph link pressed while one is focused still opens the next.
  useEffect(() => {
    if (!active) return undefined;
    const clear = () => {
      setActive(null);
      navigate(withoutFocus(), { replace: true, scroll: false });
    };
    const onKey = (e) => {
      if (e.key === 'Escape') clear();
    };
    document.addEventListener('pointerdown', clear, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', clear, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [active]);

  return { active, issue, announce };
}
