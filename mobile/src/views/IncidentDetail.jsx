import React from 'react';
import BackHeader from '../components/BackHeader.jsx';
import StatusLamp from '../components/StatusLamp.jsx';
import StatusWord from '../components/StatusWord.jsx';
import UptimeRing from '../components/UptimeRing.jsx';
import { deriveIncidents } from '../data/derive.js';
import { openTarget } from '../open.js';

/**
 * IncidentDetail — full detail for a derived incident, or a push-event fallback.
 * Read-only; the only action besides back is a demoted (ghost) Open deep-link.
 *
 * Honest numbers (Bug #2, #14): a DERIVED incident has NO real detection/event
 * time in the snapshot (no `downSince`; `ping` is latency, not age), so it gets
 * NO fabricated timeline — just a clock-less status line. A PUSH-EVENT deep-link
 * carries a real timestamp from the push record, so it renders `{event} · HH:MM`
 * from that real value. Timestamps appear ONLY where the datum genuinely exists.
 */

// Turn a differ event type ('host_unreachable') into a human title ('Host unreachable').
function humanizeType(type) {
  const s = String(type || '').replace(/_/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Incident';
}

// Format a REAL push-record timestamp (epoch-ms number/string, or ISO) → "HH:MM".
// Returns null for anything that is not a real, parseable time — honest numbers:
// no real datum, no clock. Never invents a time.
function formatClock(ts) {
  if (ts == null || ts === '') return null;
  const ms = typeof ts === 'number'
    ? ts
    : (/^\d+$/.test(String(ts).trim()) ? Number(ts) : Date.parse(ts));
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (x) => String(x).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Map a push-record severity string → lamp shape/severity/word. severity is a
// REAL field on the push payload; we never invent a status the record lacks.
function pushSeverityLamp(severity) {
  switch (severity) {
    case 'critical': return { shape: 'slash', severity: 'critical', word: 'CRITICAL' };
    case 'warning':  return { shape: 'slash', severity: 'caution',  word: 'WARNING' };
    case 'info':     return { shape: 'disc',  severity: 'healthy',  word: 'INFO' };
    default:         return { shape: 'ring',  severity: 'unknown',  word: 'UNKNOWN' };
  }
}

export default function IncidentDetail({ data, nav, params }) {
  const incidents = deriveIncidents({
    services: data.servicesBody,
    ups: data.ups,
    cron: data.cron,
  });
  const incident = incidents.find((i) => i.id === params.id);

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
            <StatusLamp shape={lamp.shape} severity={lamp.severity} label={lamp.word} size={18} />
            <StatusWord word={lamp.word} severity={lamp.severity} />
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

  // DERIVED incident: no real detection time in the snapshot → a single CLOCK-LESS
  // status line (`Active — {node}`), never a fabricated "Detected · HH:MM".
  return (
    <section className="mobile-view" aria-label="Incident detail">
      <BackHeader title={incident.title} onBack={nav.pop} />

      <div className="detail-head">
        <StatusLamp shape={incident.shape} severity={incident.severity} label={incident.word} size={18} />
        <StatusWord word={incident.word} severity={incident.severity} />
        <span className="detail-head__node">{incident.node}</span>
      </div>

      <p className="detail-cause">{incident.cause}</p>

      <UptimeRing uptime24={incident.uptime24} />

      <p className="detail-status">Active — {incident.node}</p>

      {/* Open demoted to a secondary ghost button (Bug #9). */}
      {incident.target?.url && (
        <button
          type="button"
          className="open-btn open-btn--ghost"
          onClick={() => openTarget(incident.target)}
        >
          Open
        </button>
      )}
    </section>
  );
}
