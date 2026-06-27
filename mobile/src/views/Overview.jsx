import React, { useMemo } from 'react';
import SystemStatusCard from '../components/SystemStatusCard.jsx';
import SubsystemStrip from '../components/SubsystemStrip.jsx';
import IssueRow from '../components/IssueRow.jsx';
import StatusBanner from '../components/StatusBanner.jsx';
import {
  overallSeverity, deriveSubsystems, deriveIncidents,
  flattenServices, upsDegraded, nodeSeverity,
} from '../data/derive.js';
import { openTarget } from '../open.js';

// 1 → "One", 2 → "Two", ≥3 → digit (spec §7.2 down headline rule).
const WORD_NUMBER = { 1: 'One', 2: 'Two' };
const wordNumber = (n) => WORD_NUMBER[n] || String(n);
const plural = (n, w) => `${w}${n === 1 ? '' : 's'}`;

/** Count newest-run cron failures (mirrors derive's internal allCronFailures). */
function cronFailureCount(cron) {
  if (!Array.isArray(cron)) return 0;
  let k = 0;
  for (const node of cron) {
    for (const job of node.jobs || []) {
      if ((job.runs || [])[0]?.status === 'failure') k += 1;
    }
  }
  return k;
}

/**
 * Build the hero's { severity, headline, word, subline, counts } per the spec
 * §7.2 deterministic Headline wording rule. `word` is the substring of `headline`
 * the SystemStatusCard color-spans by severity — without it the color-span
 * silently no-ops, so the Overview (Task 6) MUST derive and pass it.
 */
function buildHero(severity, { servicesBody, ups, cron }) {
  // unknown / unreachable — never green (Bug #4).
  if (severity === 'unknown') {
    return { severity, headline: 'No signal', word: 'No signal', subline: "Can't reach JagHelm", counts: '' };
  }

  const flat = flattenServices(servicesBody);
  const upCount = flat.filter((s) => s.status === 'up').length;
  const downServices = flat.filter((s) => s.status === 'down');
  const downCount = downServices.length;
  const unknownCount = flat.filter((s) => s.status === 'unknown' && s.source !== 'presence').length;
  const nodeCount = Object.keys(servicesBody?.nodes || {}).length;
  const onBattery = upsDegraded(ups);

  // Mono counts footer — shared across non-unknown states.
  const counts = [
    `${upCount} up`,
    `${downCount} down`,
    ...(unknownCount > 0 ? [`${unknownCount} unknown`] : []),
    `${nodeCount} ${plural(nodeCount, 'node')}`,
  ].join(' · ');

  // healthy
  if (severity === 'healthy') {
    const upsTail = ups ? ` — UPS on ${onBattery ? 'battery' : 'mains'}` : '';
    return {
      severity,
      headline: "Everything's healthy",
      word: 'healthy',
      subline: `${upCount} ${plural(upCount, 'service')} up across ${nodeCount} ${plural(nodeCount, 'node')}${upsTail}`,
      counts,
    };
  }

  // critical (down) — count words, up-to-2 names + "+N more", co-existing caution tail.
  if (severity === 'critical') {
    const headline = `${wordNumber(downCount)} ${plural(downCount, 'service')} down`;
    const names = downServices.slice(0, 2).map((s) => s.display_name).join(' · ');
    const more = downCount > 2 ? ` +${downCount - 2} more` : '';
    const cronFails = cronFailureCount(cron);
    let tail = '';
    if (onBattery) tail = ' — plus UPS on battery';
    else if (cronFails > 0) tail = ` — plus ${cronFails} cron ${plural(cronFails, 'failure')}`;
    return { severity, headline, word: 'down', subline: `${names}${more}${tail}`, counts };
  }

  // caution (no down) — headline the single worst caution by precedence
  // ups → cron → node-hot → unknown; summarize the rest in the subline.
  const cautions = [];
  if (onBattery) {
    const charge = ups && ups.charge != null ? Math.round(ups.charge) : null;
    cautions.push({ headline: 'UPS on battery', word: 'battery', prose: `On battery power${charge != null ? ` — ${charge}% charge` : ''}.` });
  }
  const cronFails = cronFailureCount(cron);
  if (cronFails > 0) {
    cautions.push({ headline: `${cronFails} cron ${plural(cronFails, 'job')} failed`, word: 'failed', prose: `${cronFails} cron ${plural(cronFails, 'job')} reported a failure.` });
  }
  const hotCount = Object.values(servicesBody?.nodes || {}).filter((n) => nodeSeverity(n) === 'caution').length;
  if (hotCount > 0) {
    cautions.push({ headline: `${hotCount} ${plural(hotCount, 'node')} running hot`, word: 'hot', prose: `${hotCount} ${plural(hotCount, 'node')} over the resource threshold.` });
  }
  if (unknownCount > 0) {
    cautions.push({ headline: `${unknownCount} ${plural(unknownCount, 'service')} unknown`, word: 'unknown', prose: `${unknownCount} ${plural(unknownCount, 'service')} not reporting.` });
  }

  const first = cautions[0] || { headline: 'Degraded', word: 'Degraded', prose: 'A subsystem needs attention.' };
  const rest = cautions.slice(1).map((c) => c.prose).join(' ');
  return { severity, headline: first.headline, word: first.word, subline: rest || first.prose, counts };
}

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
  const hero = useMemo(() => buildHero(severity, { servicesBody, ups, cron }), [severity, servicesBody, ups, cron]);

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
