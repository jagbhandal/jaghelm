import React from 'react';
import BackHeader from '../components/BackHeader.jsx';
import {
  DetailLoading,
  DetailStatus,
  DetailTitle,
  DetailUnreachable,
} from '../components/DetailParts.jsx';
import { detailLoading, sinceLine } from '../data/detail.js';
import { Button } from '@ui/button';
import { FactList } from '@ui/fact-list';
import { DetailFacts, DetailSections, DetailUnread } from '@ui/entity-detail';
import { flattenServices, formatClock, uptimePct } from '../data/derive.js';
import { FRESH, issueRowsOf, upsReadingsOf } from '../data/board.js';
import { issueFor } from '../nav/issueRoute.js';
import { entityFor } from '../nav/entityRoute.js';
import { usePhonePlatform } from '../platform.js';
import { useStatusAt } from '../../shell/statusFreshness.js';

/**
 * IncidentDetail — full detail for one of the status model's issues (#325),
 * found by its entity id (`params.id`: a row's, a tapped push's, or the web's
 * `?entity=` URL's, #309), or a push-event fallback. Read-only; the only
 * action besides back is a demoted (ghost) Open deep-link.
 *
 * Honest numbers (Bug #2, #14): an issue gets NO fabricated timeline — just a
 * clock-less status line. A PUSH-EVENT deep-link carries a real timestamp from
 * the push record, so it renders `{event} · HH:MM` from that real value.
 * Timestamps appear ONLY where the datum genuinely exists.
 */

// Turn a differ event type ('host_unreachable') into a human title ('Host unreachable').
function humanizeType(type) {
  const s = String(type || '')
    .replace(/_/g, ' ')
    .trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Incident';
}

// Map a push-record severity string → lamp shape/state/word: the state the
// server's severity stands for (critical is crit, warning warn, info ok, as
// the cross-client suite holds push to the model). severity is a REAL field
// on the push payload; we never invent a status the record lacks.
function pushSeverityLamp(severity) {
  switch (severity) {
    case 'critical':
      return { shape: 'slash', state: 'crit', word: 'CRITICAL' };
    case 'warning':
      return { shape: 'slash', state: 'warn', word: 'WARNING' };
    case 'info':
      return { shape: 'disc', state: 'ok', word: 'INFO' };
    default:
      return { shape: 'ring', state: 'unknown', word: 'UNKNOWN' };
  }
}

/**
 * IncidentDetail is the Phone board's sheet (#303): Back and the kind of thing
 * it is ("Backup", the first word of where it is) over its name and where it
 * is, the status box (the model's word and reason, and "Active — where"),
 * the UPS's readings or the service's 24 h uptime, and Open for a service
 * with an address, and how long it has been so (the model's `since`). An
 * entity the model has that is no issue (the UPS on mains, a job that ran;
 * opened from its URL, #309) is drawn the same, without "Active". A tapped
 * push's event that the status no longer has: its event, severity and
 * time. An id the model has nothing by (it
 * was removed or renamed, or the link is old): "No longer monitored"; a
 * failed source that answers again: resolved. The facts and
 * sections the desktop's drawer shows (#310, `data.extras`,
 * src/shell/PhoneDetail.jsx): the UPS's charge, runtime, load and model, an
 * integration's stats, a job's schedule, last report and runs, and its
 * Remove (`actions`, #578). Drawn before the status and the cards
 * have answered, it waits for them; with no status to read, it says why,
 * never "resolved".
 */
export default function IncidentDetail({ data, nav, params, actions = null }) {
  const { openTarget } = usePhonePlatform();
  const at = useStatusAt(data.updated);
  if (detailLoading(data)) return <DetailLoading kind="Alert" onBack={nav.pop} />;
  // An issue, else the entity as the model has it now (#309).
  const issue = issueFor(data.status, params.id);
  const found = issue ?? entityFor(data.status, params.id);
  const incident = found
    ? issueRowsOf({ status: { issues: [found] }, freshness: data.freshness ?? FRESH })[0]
    : null;
  const card =
    incident?.target.kind === 'service'
      ? flattenServices(data.servicesBody).find((s) => s.uid === incident.target.uid)
      : null;
  // The UPS's runtime left on battery ("8 min left"), while the status is fresh.
  const readings =
    incident?.kind === 'ups'
      ? upsReadingsOf({ status: data.status, ups: data.ups, freshness: data.freshness ?? FRESH })
      : null;

  if (!incident) {
    if (params.type) {
      const title = humanizeType(params.type);
      const lamp = pushSeverityLamp(params.severity);
      const clock = formatClock(params.ts);
      return (
        <>
          <BackHeader kind="Alert" onBack={nav.pop} />
          <div className="flex flex-col gap-4 p-4">
            <DetailTitle title={title} where={params.node} />
            <DetailStatus
              state={lamp.state}
              word={lamp.word}
              reason="Live status for this event is not in the current snapshot — it may have resolved."
              note={clock ? `${title} · ${clock}` : undefined}
            />
            {params.severity && (
              <FactList facts={[{ key: 'severity', label: 'Severity', value: params.severity }]} />
            )}
          </div>
        </>
      );
    }
    if (!data.status) return <DetailUnreachable kind="Alert" onBack={nav.pop} data={data} />;
    // A failed source is an issue only while it fails; anything else the
    // model no longer has is gone from it.
    const resolved = typeof params.id === 'string' && params.id.startsWith('sources/');
    return (
      <>
        <BackHeader kind="Alert" onBack={nav.pop} />
        <div className="flex flex-col gap-4 p-4">
          <DetailTitle title={resolved ? 'Incident' : 'No longer monitored'} />
          <p className="text-text-2">
            {resolved
              ? 'This incident has resolved.'
              : 'JagHelm doesn’t watch anything by this name now: it was removed or renamed, or the link is old.'}
          </p>
        </div>
      </>
    );
  }

  const kind = incident.readout.split(' · ')[0] || 'Alert';
  const extras = data.extras ?? null;
  const facts =
    extras?.facts ??
    [
      readings && { key: 'ups', label: 'UPS', value: readings },
      card?.uptime24 != null && {
        key: 'uptime',
        label: 'Uptime · 24 h',
        value: `${uptimePct(card.uptime24)} %`,
      },
    ].filter(Boolean);
  return (
    <>
      <BackHeader kind={kind} onBack={nav.pop} />
      <div className="flex flex-col gap-4 p-4">
        <DetailTitle title={incident.title} where={incident.readout} />
        <DetailStatus
          state={incident.state}
          word={incident.word}
          reason={incident.cause}
          since={sinceLine(found.since, at, data.freshness)}
          note={issue ? `Active — ${incident.readout}` : undefined}
        />
        <DetailFacts facts={facts} lastKnown={extras?.lastKnown} />
        <DetailSections sections={extras?.sections} muted={Boolean(extras?.lastKnown)} />
        {actions}
        <DetailUnread unread={extras?.unread} />
        {card?.url && (
          <Button
            variant="primary"
            className="mt-1 h-12 w-full"
            onClick={() => openTarget({ kind: 'service', uid: card.uid, url: card.url })}
          >
            Open {card.display_name || incident.title}
          </Button>
        )}
      </div>
    </>
  );
}
