import React, { useMemo } from 'react';
import SystemStatusCard from '../components/SystemStatusCard.jsx';
import SubsystemStrip from '../components/SubsystemStrip.jsx';
import IssueRow from '../components/IssueRow.jsx';
import StatusBanner from '../components/StatusBanner.jsx';
import {
  overallSeverity, deriveSubsystems, deriveIncidents, deriveHero,
} from '../data/derive.js';
import { openTarget } from '../open.js';

export default function Overview({ data }) {
  const { servicesBody, ups, cron, loading, error } = data;
  // Bug #4: a live fetch error means we can't trust the (possibly stale) body.
  // Thread `unreachable` into BOTH overallSeverity and deriveSubsystems so a
  // mid-session outage forces steel / NO SIGNAL, never stale green.
  const unreachable = error != null;

  const severity = useMemo(
    () => overallSeverity({ services: servicesBody, ups, cron, unreachable }),
    [servicesBody, ups, cron, unreachable],
  );
  const cells = useMemo(
    () => deriveSubsystems({ services: servicesBody, ups, cron, unreachable }),
    [servicesBody, ups, cron, unreachable],
  );
  // No issues list while unreachable — the error banner stands in (spec §7.2).
  const incidents = useMemo(
    () => (unreachable ? [] : deriveIncidents({ services: servicesBody, ups, cron })),
    [servicesBody, ups, cron, unreachable],
  );
  const hero = useMemo(() => deriveHero(severity, { services: servicesBody, ups, cron }), [severity, servicesBody, ups, cron]);

  return (
    <section className="mobile-view" aria-label="Overview">
      <SystemStatusCard
        severity={hero.severity}
        headline={hero.headline}
        word={hero.word}
        subline={hero.subline}
        counts={hero.counts}
      />

      <SubsystemStrip cells={cells} />

      <section className="overview-issues" aria-label="Active issues">
        <h2 className="overview-issues__title">Active issues</h2>
        <StatusBanner loading={loading} error={error} hasData={!!servicesBody} />

        {!error && !loading && incidents.length > 0 && (
          <div className="overview-issues__list">
            {incidents.map((inc) => (
              <IssueRow key={inc.id} incident={inc} onOpen={openTarget} />
            ))}
          </div>
        )}

        {!error && !loading && incidents.length === 0 && severity === 'healthy' && (
          <div className="overview-clear">
            <p className="overview-clear__msg">🌙 Nothing on fire.</p>
            {/* Honest numbers: the snapshot has no last-incident time, so we
                render the no-data token (—), never a synthesized "3 days ago". */}
            <p className="overview-clear__sub">last incident · —</p>
          </div>
        )}

        {!error && !loading && incidents.length === 0 && severity === 'caution' && (
          <p className="overview-issues__empty">No active issues.</p>
        )}
      </section>
    </section>
  );
}
