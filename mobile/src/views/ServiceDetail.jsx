import React from 'react';
import BackHeader from '../components/BackHeader.jsx';
import StatusLamp from '../components/StatusLamp.jsx';
import StatusWord from '../components/StatusWord.jsx';
import UptimeRing from '../components/UptimeRing.jsx';
import { flattenServices, statusToShape, statusToSeverity } from '../data/derive.js';
import { lastSeenLabel } from '@shared/util/relativeTime.js';
import { openTarget } from '../open.js';

/**
 * ServiceDetail — full detail for one service within the current snapshot.
 *
 * Honest numbers (§7.6): the server has no time-series and no "down since",
 * so this screen NEVER synthesizes a time. `ping` is LATENCY (header `{ping}ms`),
 * never reinterpreted as an age. The only "X ago" line shown is a presence
 * breadcrumb's real `lastSeenAt`; absent that, the line is omitted entirely.
 */
export default function ServiceDetail({ data, nav, params }) {
  const svc = flattenServices(data.servicesBody).find((s) => s.uid === params.uid);
  if (!svc) {
    return (
      <section className="mobile-view" aria-label="Service detail">
        <BackHeader title="Service" onBack={nav.pop} />
        <p className="mobile-view__todo">This service is no longer reported.</p>
      </section>
    );
  }

  const isDown = svc.status === 'down';
  const isUp = svc.status === 'up';
  const isBreadcrumb = svc.source === 'presence';
  const word = (svc.status ?? 'unknown').toUpperCase();
  const shape = statusToShape(svc.status, svc.source);
  const severity = statusToSeverity(svc.status, svc.source);

  return (
    <section className="mobile-view" aria-label="Service detail">
      <BackHeader title={svc.display_name} onBack={nav.pop} />

      <div className="detail-head">
        <StatusLamp shape={shape} severity={severity} label={word} size={18} />
        <StatusWord word={word} severity={severity} />
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

      {/* DOWN — cause/where in DM Sans. Docker CPU/MEM is deliberately HIDDEN
          (Bug #12: no "CPU 0% MEM 0 MB" for a stopped container). */}
      {isDown && (
        <p className="detail-cause">Service is down · {svc.nodeName}</p>
      )}

      {/* Docker metrics render ONLY when the service is actually up. */}
      {isUp && svc.docker && (
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
