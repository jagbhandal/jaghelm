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
 * quiet: no ring, no error. "Drawn" is a key of `charts`: a Panel in the page
 * for a chart outside it (the phone's "not on the phone yet" row, #805) is
 * left alone too. It is looked for again as the answers come, until
 * found, and focused once per address: the page's refreshes don't scroll it
 * back. Reduced motion scrolls at once.
 *
 * Returns `{ active, issueOf, announce }`: the focused chart's id (or null),
 * a function from a chart id to the status issue it is focused for (or
 * undefined), and the live region's text.
 */
import { useEffect, useRef, useState } from 'react';
import { FOCUS_PARAM, ISSUE_PARAM, chartOfIssue } from '../../server/monitoringFocus.js';
import { navigate, useSearchParam } from '../router/useRoute.js';

const reduced = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The address without `focus`. */
function withoutFocus() {
  const params = new URLSearchParams(window.location.search);
  params.delete(FOCUS_PARAM);
  params.delete(ISSUE_PARAM);
  const rest = params.toString();
  return `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`;
}

/**
 * @param {{ loaded: boolean, status?: any, charts: Record<string, string> }} input
 *   `loaded`: the page's charts are drawn (their answer is in); `charts`:
 *   chart id -> its title, for the announcement; also the charts that can be
 *   focused, so a caller passes only those it draws (#805)
 */
export function useChartFocus({ loaded, status, charts }) {
  const param = useSearchParam(FOCUS_PARAM);
  const [active, setActive] = useState(null);
  const [announce, setAnnounce] = useState('');
  // The address already focused, so a refresh of the charts doesn't scroll again.
  const done = useRef(null);

  const issueParam = useSearchParam(ISSUE_PARAM);
  // The clicked row's issue, else the first that opens the chart.
  const mapped = param ? (status?.issues ?? []).filter((i) => chartOfIssue(i) === param) : [];
  const issue = mapped.find((i) => i.id === issueParam) ?? mapped[0];
  const issueId = issue?.id ?? null;
  // Latest reading, for the announcement made once per focus (not each poll).
  const latest = useRef(issue);
  latest.current = issue;

  useEffect(() => {
    if (!param) {
      done.current = null;
      setActive(null);
      return;
    }
    if (!loaded || done.current === param) return;
    // Not a chart this page draws: quiet, even if a Panel stands in for it (#805).
    if (!Object.hasOwn(charts, param)) {
      setActive(null);
      return;
    }
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
    // `charts` changes only with the answer that sets `loaded`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [param, loaded]);

  // Said once per focus (or when the issue it is for changes), not on each poll.
  useEffect(() => {
    const i = latest.current;
    const said = i ? `${i.name}, ${i.word}, ${i.reason}` : '';
    setAnnounce(active ? [charts[active] ?? active, said].filter(Boolean).join(': ') : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, issueId]);

  // The next press anywhere, or Escape, clears it. A press (not a click) so a
  // View graph link pressed while one is focused still opens the next.
  useEffect(() => {
    if (!active) return undefined;
    const clear = () => {
      setActive(null);
      navigate(withoutFocus(), { replace: true, scroll: false });
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) clear();
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
