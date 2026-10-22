import React from 'react';
import BackHeader from '../components/BackHeader.jsx';
import { StatusLamp } from '@ui/status-lamp';
import { StatusWord } from '@ui/status-word';
import UptimeRing from '../components/UptimeRing.jsx';
import { flattenServices, formatClock } from '../data/derive.js';
import { FRESH, issueRowsOf, upsReadingsOf } from '../data/board.js';
import { issueFor } from '../nav/issueRoute.js';
import { openTarget } from '../open.js';

/**
 * IncidentDetail — full detail for one of the status model's issues (#325),
 * found by its entity id (`params.id`: a row's, or a tapped push's, reconciled
 * by push/fcmIdToIncidentId.js), or a push-event fallback. Read-only; the only
 * action besides back is a demoted (ghost) Open deep-link.
 *
 * Honest numbers (Bug #2, #14): an issue gets NO fabricated timeline — just a
 * clock-less status line. A PUSH-EVENT deep-link carries a real timestamp from
 * the push record, so it renders `{event} · HH:MM` from that real value.
 * Timestamps appear ONLY where the datum genuinely exists.
 */

// Turn a differ event type ('host_unreachable') into a human title ('Host unreachable').
function humanizeType(type) {
  const s = String(type || '').replace(/_/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Incident';
}

// Map a push-record severity string → lamp shape/state/word: the state the
// server's severity stands for (critical is crit, warning warn, info ok, as
// the cross-client suite holds push to the model). severity is a REAL field
// on the push payload; we never invent a status the record lacks.
function pushSeverityLamp(severity) {
  switch (severity) {
    case 'critical': return { shape: 'slash', state: 'crit', word: 'CRITICAL' };
    case 'warning':  return { shape: 'slash', state: 'warn', word: 'WARNING' };
    case 'info':     return { shape: 'disc',  state: 'ok',   word: 'INFO' };
    default:         return { shape: 'ring',  state: 'unknown', word: 'UNKNOWN' };
  }
}

export default function IncidentDetail({ data, nav, params }) {
  // The issue as a row draws it: the model's state (no signal while stale),
  // word, name, where and reason.
  const found = issueFor(data.status, params.id);
  const incident = found
    ? issueRowsOf({ status: { issues: [found] }, freshness: data.freshness ?? FRESH })[0]
    : null;
  // A service's card, for its 24 h uptime and its link.
  const card =
    incident?.target.kind === 'service'
      ? flattenServices(data.servicesBody).find((s) => s.uid === incident.target.uid)
      : null;
  // The UPS's readings the model doesn't carry ("8 min left"), for its issue.
  const readings = incident?.kind === 'ups' ? upsReadingsOf({ status: data.status, ups: data.ups }) : null;

  if (!incident) {
    // No live derived incident. If the deep-link carried push-event params, render
    // a real push-event detail from them (host events have NO derived incident by
    // design; or the incident has since resolved). The timestamp is rendered ONLY
    // when the push record carried a real one — never synthesized.
    if (params.type) {
      const title = humanizeType(params.type);
      const lamp = pushSeverityLamp(params.severity);
      const clock = formatClock(params.ts);
      return (
        <section className="mobile-view" aria-label="Incident detail">
          {/* title lives in the header AND the status line below; tests query the
              status line by its `· HH:MM` suffix, not the bare title. */}
          <BackHeader title={title} onBack={nav.pop} />
          <div className="detail-head">
            <StatusLamp shape={lamp.shape} state={lamp.state} label={lamp.word} size={18} />
            <StatusWord word={lamp.word} state={lamp.state} />
            <span className="detail-head__node">{params.node || params.fcmId}</span>
          </div>

          {/* Push records DO carry a real event time → render {event} · HH:MM.
              Absent a real timestamp, render NO line at all — never a fake clock,
              and never a bare title echo (the header already carries it). */}
          {clock && <p className="detail-status">{`${title} · ${clock}`}</p>}

          {params.severity && (
            <p className="push-event__severity">Severity: {params.severity}</p>
          )}
          <p className="push-event__note">
            Live status for this event is not in the current snapshot — it may have resolved.
          </p>
        </section>
      );
    }
    return (
      <section className="mobile-view" aria-label="Incident detail">
        <BackHeader title="Incident" onBack={nav.pop} />
        <p className="mobile-view__todo">This incident has resolved.</p>
      </section>
    );
  }

  // A live issue: a single CLOCK-LESS status line (`Active — {where}`), never a
  // fabricated "Detected · HH:MM".
  return (
    <section className="mobile-view" aria-label="Incident detail">
      <BackHeader title={incident.title} onBack={nav.pop} />

      <div className="detail-head">
        <StatusLamp shape={incident.shape} state={incident.state} label={incident.word} size={18} />
        <StatusWord word={incident.word} state={incident.state} />
        <span className="detail-head__node">{incident.readout}</span>
      </div>

      <p className="detail-cause">{incident.cause}</p>
      {readings && <p className="detail-readings">{readings}</p>}

      <UptimeRing uptime24={card?.uptime24 ?? null} state={incident.state} />

      <p className="detail-status">Active — {incident.readout}</p>

      {/* Open demoted to a secondary ghost button (Bug #9). */}
      {card?.url && (
        <button
          type="button"
          className="open-btn open-btn--ghost"
          onClick={() => openTarget({ kind: 'service', uid: card.uid, url: card.url })}
        >
          Open
        </button>
      )}
    </section>
  );
}
