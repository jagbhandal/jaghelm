import React, { useMemo } from 'react';
import { Database } from 'lucide-react';
import { PHONE_WIDTH, ShellSection } from '@ui/app-shell';
import { SourceList } from '@ui/source-list';
import { followLink } from '../../../router/useRoute.js';
import { pathTo } from '../../../router/routes.js';
import { overviewPath } from '../../../shell/overviewFilter.js';
import { useMediaQuery } from '../../../shell/useMediaQuery.js';
import { useStatusAt, useStatusFreshness } from '../../../shell/statusFreshness.js';
import { settingsHref } from '../sections.js';
import { configRow, cronRow, sourceRows } from './sourcesView.js';

/**
 * Settings → Sources (#318, spec §7): Prometheus, Uptime Kuma, NUT, Gitea and
 * the cron reporters, each with its live health, from the status the header
 * polls (useStatus, App.jsx: no request of its own), so it moves with the
 * board and greys with it when that status goes stale (statusFreshness.js,
 * #480, #559). What each row says is sourcesView.js's, from the model alone;
 * SourceList (src/ui/source-list.jsx) draws them.
 *
 * Their addresses are set in JagHelm's .env and aren't edited here; each row
 * names its variable, never its value. The cron reporters' row links to the
 * Jobs section, which lists the jobs it counts: the Overview filtered to
 * Jobs or to Backups when only that kind reports, else the whole Overview,
 * which shows both; on a phone the Infrastructure tab, which lists both.
 * While services.yaml can't be used, a row for it comes first, linking to
 * Nodes & Services.
 */
export default function Sources({ status = null, reach = 'loading', updated = null }) {
  const freshness = useStatusFreshness({ status, reach, updated });
  const at = useStatusAt(updated);
  const phone = useMediaQuery(PHONE_WIDTH);
  const rows = useMemo(() => {
    const jobsHref = (subsystem) => (phone ? pathTo('infrastructure') : overviewPath(subsystem));
    return [
      configRow({ status, freshness, at, href: settingsHref('nodes') }),
      ...sourceRows({ status, freshness, at }),
      cronRow({ status, freshness, at, jobsHref }),
    ].filter(Boolean);
  }, [status, freshness, at, phone]);
  return (
    <ShellSection>
      <SourceList
        title="Data sources"
        description="Each is set in JagHelm’s .env, not here: change one there, then restart JagHelm."
        note={freshness.stale ? freshness.note : null}
        rows={rows}
        onNavigate={followLink}
      />
    </ShellSection>
  );
}

Sources.icon = <Database />;
