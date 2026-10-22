import React from 'react';
import BackHeader from '../components/BackHeader.jsx';
import { StatusLamp } from '@ui/status-lamp';
import { StatusWord } from '@ui/status-word';
import UptimeRing from '../components/UptimeRing.jsx';
import { FRESH, serviceRowsOf } from '../data/board.js';
import { lastSeenLabel } from '@shared/util/relativeTime.js';
import { openTarget } from '../open.js';

/**
 * ServiceDetail — full detail for one service within the current snapshot,
 * its lamp, word and reason the status model's (#325).
 *
 * Honest numbers (§7.6): this screen NEVER synthesizes a time. `ping` is
 * LATENCY (header `{ping}ms`), never reinterpreted as an age. The only "X ago"
 * line shown is a presence breadcrumb's real `lastSeenAt`; absent that, the
 * line is omitted entirely.
 */
export default function ServiceDetail({ data, nav, params }) {
  const svc = serviceRowsOf({
    status: data.status,
    servicesBody: data.servicesBody,
    freshness: data.freshness ?? FRESH,
  }).find((s) => s.uid === params.uid);
  if (!svc) {
    return (
      <section className="mobile-view" aria-label="Service detail">
        <BackHeader title="Service" onBack={nav.pop} />
        <p className="mobile-view__todo">This service is no longer reported.</p>
      </section>
    );
  }

  // The model's own state, not the one drawn: a stale status keeps its words.
  const healthy = svc.modelState === 'ok';
  const isBreadcrumb = svc.source === 'presence';

  return (
    <section className="mobile-view" aria-label="Service detail">
      <BackHeader title={svc.display_name} onBack={nav.pop} />

      <div className="detail-head">
        <StatusLamp state={svc.state} label={svc.word} size={18} />
        <StatusWord word={svc.word} state={svc.state} />
        <span className="detail-head__node">{svc.nodeName}</span>
        {svc.ping != null && svc.ping > 0 && (
          <span className="detail-head__ping">{svc.ping}ms</span>
        )}
      </div>

      {/* uptime24 radial gauge — UptimeRing omits itself when uptime24 == null. */}
      <UptimeRing uptime24={svc.uptime24} />

      {/* "Last seen" — REAL timestamps only: a presence breadcrumb that carries a
          real lastSeenAt. No lastSeenAt → omit the line. ping is never an age. */}
      {isBreadcrumb && svc.lastSeenAt != null && (
        <p className="detail-lastseen">{lastSeenLabel(svc.lastSeenAt)}</p>
      )}

      {/* Not healthy: the model's reason and where, in DM Sans. Docker CPU/MEM
          is deliberately HIDDEN (Bug #12: no "CPU 0% MEM 0 MB" for a stopped
          container). */}
      {!healthy && svc.reason && (
        <p className="detail-cause">{svc.reason} · {svc.nodeName}</p>
      )}

      {/* Docker metrics render ONLY when the model has the service healthy. */}
      {healthy && svc.docker && (
        <div className="detail-docker">
          {svc.docker.cpu != null && <span>CPU {svc.docker.cpu}%</span>}
          {svc.docker.memMB != null && <span>MEM {svc.docker.memMB} MB</span>}
        </div>
      )}

      {/* Open demoted to a secondary ghost button (Bug #9) — navigation to this
          screen is the primary affordance, not a loud indigo fill. */}
      {svc.url && (
        <button
          type="button"
          className="open-btn open-btn--ghost"
          onClick={() => openTarget({ kind: 'service', uid: svc.uid, url: svc.url })}
        >
          Open
        </button>
      )}
    </section>
  );
}
