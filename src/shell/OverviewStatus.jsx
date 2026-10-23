/**
 * The top of the Overview (#297, spec §8 item 1): is anything wrong, what and
 * where, from the header's poll. With issues, the attention panel, each row
 * opening its entity's detail over the page (its URL, #309, entityNav.js),
 * and "All alerts" to the Alerts page; with none, the quiet line. It shares
 * the wiring with the Alerts page (ShellAttention): no signal is a Banner over
 * the last status, and the first load a placeholder.
 *
 * Under it, the subsystem strip (#298, spec §8 item 2): a tile per subsystem
 * the model has anything in, in its order, with its state, word and detail
 * ("11 / 12 up"), from the same poll (statusView.js subsystemCells). Each
 * tile is a toggle that filters the page to its subsystem (`filter`, the
 * URL's, overviewFilter.js): the panel's rows narrow to it, and the sections
 * below to its own (OverviewBoard). Pressing it again, or Clear, shows
 * everything. With a stale status, the tiles keep their counts, as last
 * known, but are drawn as no signal (statusFreshness.js, #480).
 *
 * It is drawn from 768px only: below it, the web draws the phone screens
 * (#303, PhoneView.jsx), whose Overview is the Phone board's, the panel split
 * around the strip (#484's split moved there).
 *
 * The strip can be switched off (Settings → Appearance → Overview sections,
 * #307: `strip` false); the panel can't. A filter in the URL still narrows
 * the page, the panel saying so with Clear.
 *
 * A root of its own (ShellSection) inside a wrapper that lines it up with the
 * sections under it (`.overview-status`, global.css). Memoised on the poll,
 * so the sections' tick doesn't re-render it; each answer re-renders only its
 * ages.
 */
import { memo, useMemo } from 'react';
import { ShellSection } from '@ui/app-shell';
import { buttonVariants } from '@ui/button';
import { SubsystemStrip } from '@ui/subsystem-strip';
import { cn } from '@ui/lib/utils';
import { followLink } from '../router/useRoute.js';
import { pathTo } from '../router/routes.js';
import { ShellAttention } from './ShellAttention.jsx';
import { entityLink } from './entityNav.js';
import { clearOverviewFilter, filterOverview } from './overviewFilter.js';
import { useStatusFreshness } from './statusFreshness.js';
import { subsystemCells } from './statusView.js';

const ALERTS = pathTo('alerts');
// The panel's action, the mock's "All alerts →": a link drawn as an accent
// ghost button. Through cn, as Button does, so the accent text wins over the
// ghost's text-2.
const LINK = cn(buttonVariants({ variant: 'ghost', size: 'sm', tone: 'accent' }));

// Each issue's row opens its entity over the Overview.
const linkOf = (entity) => entityLink(entity.id);

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
        />
      </ShellSection>
    </div>
  );
});
