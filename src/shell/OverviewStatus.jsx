/**
 * The top of the Overview (#297, spec §8 item 1): is anything wrong, what and
 * where, from the header's poll. With issues, the attention panel, its rows
 * leading to each entity's place on today's board below, when the board
 * draws it (entityAnchors.js), and "All alerts" to the Alerts page; with none, the quiet line. It shares
 * the wiring with the Alerts page (ShellAttention): no signal is a Banner over
 * the last status, and the first load a placeholder.
 *
 * Under it, the subsystem strip (#298, spec §8 item 2): a tile per subsystem
 * the model has anything in, in its order, with its state, word and detail
 * ("11 / 12 up"), from the same poll (statusView.js subsystemCells). Each
 * tile is a toggle that filters the page to its subsystem (`filter`, the
 * URL's, overviewFilter.js): the panel's rows narrow to it, and the board
 * below to its panels (DashboardView). Pressing it again, or Clear, shows
 * everything. With a stale status, the tiles keep their counts, as last
 * known, but are drawn as no signal (statusFreshness.js, #480).
 *
 * On a phone (below 768px, the shell's own breakpoint, `md`) the strip moves
 * up between the panel's header and its rows (#484, spec §8 "Phone width"),
 * as the Phone board orders it: status card, strip, issue list. So a real
 * incident's rows can't push the strip below the fold. It is the panel's
 * `between`, drawn by the panel (AttentionPanel `split`), so one panel with
 * one heading takes the focus header, tiles, rows; from 768px the panel is
 * one card again with the strip under it. The width is the window's, read
 * with matchMedia on the shell's own PHONE_WIDTH (@ui/app-shell), and a
 * resize across it moves the strip.
 *
 * The strip can be switched off (Settings → Appearance → Overview sections,
 * #307: `strip` false); the panel can't. Without the strip a phone draws the
 * panel as one card, with nothing to split around, and a filter in the URL
 * still narrows the page, the panel saying so with Clear.
 *
 * It is the new UI over today's board, which later cards rebuild (#298–#300):
 * a root of its own (ShellSection) inside a wrapper that lines it up with the
 * board's cards (`.overview-status`, global.css). Memoised on the poll, so the
 * board's tick doesn't re-render it; each answer re-renders only its ages, and
 * a place coming onto the board or leaving it, only its links.
 */
import { memo, useMemo } from 'react';
import { PHONE_WIDTH, ShellSection } from '@ui/app-shell';
import { buttonVariants } from '@ui/button';
import { SubsystemStrip } from '@ui/subsystem-strip';
import { cn } from '@ui/lib/utils';
import { followLink } from '../router/useRoute.js';
import { pathTo } from '../router/routes.js';
import { ShellAttention } from './ShellAttention.jsx';
import { useRowLink } from './entityAnchors.js';
import { clearOverviewFilter, filterOverview } from './overviewFilter.js';
import { useStatusFreshness } from './statusFreshness.js';
import { subsystemCells } from './statusView.js';
import { useMediaQuery } from './useMediaQuery.js';

const ALERTS = pathTo('alerts');
// The panel's action, the mock's "All alerts →": a link drawn as an accent
// ghost button. Through cn, as Button does, so the accent text wins over the
// ghost's text-2.
const LINK = cn(buttonVariants({ variant: 'ghost', size: 'sm', tone: 'accent' }));

const allAlerts = (
  <a href={ALERTS} className={LINK} onClick={(e) => followLink(e, ALERTS)}>
    All alerts<span aria-hidden="true"> →</span>
  </a>
);

export const OverviewStatus = memo(function OverviewStatus({
  status,
  reach,
  updated,
  filter = null,
  showStrip = true,
}) {
  const linkOf = useRowLink();
  const phone = useMediaQuery(PHONE_WIDTH);
  const freshness = useStatusFreshness({ status, reach, updated });
  const cells = useMemo(() => subsystemCells(status, freshness), [status, freshness]);
  const strip = showStrip && cells.length > 0 && (
    <SubsystemStrip cells={cells} selected={filter} onSelect={filterOverview} />
  );
  return (
    <div className="overview-status" data-slot="overview-status">
      <ShellSection>
        <ShellAttention
          status={status}
          reach={reach}
          updated={updated}
          action={allAlerts}
          linkOf={linkOf}
          filter={filter}
          onClearFilter={clearOverviewFilter}
          between={strip}
          split={phone && Boolean(strip)}
        />
      </ShellSection>
    </div>
  );
});
