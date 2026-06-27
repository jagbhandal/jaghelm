import React from 'react';
import { getServiceIcon } from '../hooks/useData';
import { lastSeenLabel } from '../util/relativeTime.js';

/**
 * ServiceCard v10 — Three layout modes
 *
 * cardLayout modes (Settings > Layout > Card Layout):
 *   list  — clean rows, no backgrounds, compact and scannable
 *   row   — subtle card background per row, the JagHelm signature look
 *   grid  — denser card boxes (original style, good for panels with many services)
 *
 * statusStyle modes (Settings > Layout > Status Style):
 *   dot     — colored status dot + left border
 *   badge   — ping + status badges right-aligned
 *   minimal — icon + name only
 *
 * Docker stats and app data appear as additional content when enabled.
 */
export default React.memo(function ServiceCard({ service, showDockerStats = true, showAppData = true, statusStyle = 'badge', cardLayout = 'row' }) {
  const icon = service.icon
    ? getServiceIcon(service.icon) || getServiceIcon(service.name)
    : getServiceIcon(service.name);

  const st = service.status || 'unknown';
  const isUp = st === 'up' || st === 'running';
  const isDown = st === 'down';
  // A presence breadcrumb (vanished, unmonitored container) is GREY — never the
  // amber that a tracked 'unknown' monitor would get. We are not claiming it broke.
  const isBreadcrumb = service.source === 'presence';
  const statusColor = isBreadcrumb
    ? 'var(--text-muted)'
    : isUp ? 'var(--green)' : isDown ? 'var(--red)' : 'var(--amber)';

  const docker = service.docker || {};
  const showStats = showDockerStats && (docker.cpu != null || docker.memMB != null);
  const appData = service.appData;
  // Split the integration "doctor" (last redacted fetch error) out of the
  // display stats so it renders as a "why is this dashed?" affordance rather
  // than as a garbage stat tile.
  const doctor = appData?._doctor || null;
  const appStats = appData
    ? Object.fromEntries(Object.entries(appData).filter(([k]) => k !== '_doctor'))
    : null;
  const showApp = showAppData && appStats && Object.keys(appStats).length > 0;
  const showDoctor = showAppData && !!doctor?.error;
  const showBorder = statusStyle !== 'minimal';

  if (cardLayout === 'list') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 4px',
        borderBottom: '1px solid var(--border-color)',
        minWidth: 0,
      }}>
        {statusStyle === 'dot' && <StatusDot color={statusColor} isUp={isUp} isDown={isDown} />}
        {statusStyle === 'minimal' && <StatusGlyph color={statusColor} isUp={isUp} isDown={isDown} />}
        {icon && <ServiceIcon src={icon} size={20} />}
        <NameBlock service={service} />
        {showStats && <CompactStats docker={docker} />}
        <BadgeArea service={service} statusStyle={statusStyle} statusColor={statusColor} isUp={isUp} isDown={isDown} st={st} isBreadcrumb={isBreadcrumb} />
      </div>
    );
  }

  if (cardLayout === 'row') {
    return (
      <div style={{
        background: 'var(--bg-card-inner)', border: '1px solid var(--border-color)',
        borderRadius: 10,
        borderLeft: showBorder ? `3px solid ${statusColor}` : '1px solid var(--border-color)',
        padding: '10px 14px',
        overflow: 'hidden', minWidth: 0, minHeight: 105,
      }}>
        {/* Primary row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {statusStyle === 'dot' && <StatusDot color={statusColor} isUp={isUp} isDown={isDown} />}
          {statusStyle === 'minimal' && <StatusGlyph color={statusColor} isUp={isUp} isDown={isDown} />}
          {icon && <ServiceIcon src={icon} size={24} />}
          <NameBlock service={service} />
          <BadgeArea service={service} statusStyle={statusStyle} statusColor={statusColor} isUp={isUp} isDown={isDown} st={st} isBreadcrumb={isBreadcrumb} />
        </div>

        {/* Docker stats row */}
        {showStats && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-color)' }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 6,
            }}>
              <GridStat label="CPU" value={docker.cpu != null ? `${docker.cpu}%` : '—'} />
              <GridStat label="MEM" value={docker.memMB != null ? formatMem(docker.memMB) : '—'} />
              <GridStat label="RX" value={docker.rxMB != null ? formatMem(docker.rxMB) : '—'} />
              <GridStat label="TX" value={docker.txMB != null ? formatMem(docker.txMB) : '—'} />
            </div>
            {service.uptime != null && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, marginTop: 6 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: 0.5 }}>24H</span>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500,
                  color: service.uptime > 0.99 ? 'var(--green)' : service.uptime > 0.95 ? 'var(--amber)' : 'var(--red)',
                }}>{(service.uptime * 100).toFixed(1)}%</span>
              </div>
            )}
          </div>
        )}

        {/* App data row — centered grid with label on top, value below */}
        {showApp && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Object.keys(appStats).length}, 1fr)`,
            gap: 6, marginTop: 8, paddingTop: 8,
            borderTop: '1px solid var(--border-color)',
          }}>
            {Object.entries(appStats).map(([label, value]) => (
              <GridStat key={label} label={label} value={String(value)} />
            ))}
          </div>
        )}
        {showDoctor && <IntegrationDoctor error={doctor.error} />}
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--bg-card-inner)', border: '1px solid var(--border-color)',
      borderRadius: 10,
      borderLeft: showBorder ? `3px solid ${statusColor}` : '1px solid var(--border-color)',
      padding: showStats || showApp ? '12px 14px' : '10px 12px',
      overflow: 'hidden', minWidth: 0, minHeight: 105,
    }}>
      {/* Header: icon + name + badges */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: showStats || showApp ? 8 : 0 }}>
        {statusStyle === 'dot' && <StatusDot color={statusColor} isUp={isUp} isDown={isDown} />}
        {statusStyle === 'minimal' && <StatusGlyph color={statusColor} isUp={isUp} isDown={isDown} />}
        {icon && <ServiceIcon src={icon} size={20} />}
        <NameBlock service={service} />
        <BadgeArea service={service} statusStyle={statusStyle} statusColor={statusColor} isUp={isUp} isDown={isDown} st={st} isBreadcrumb={isBreadcrumb} compact />
      </div>

      {/* Stats grid */}
      {showStats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
          <GridStat label="CPU" value={docker.cpu != null ? `${docker.cpu}%` : '—'} />
          <GridStat label="MEM" value={docker.memMB != null ? formatMem(docker.memMB) : '—'} />
          <GridStat label="RX" value={docker.rxMB != null ? formatMem(docker.rxMB) : '—'} />
          <GridStat label="TX" value={docker.txMB != null ? formatMem(docker.txMB) : '—'} />
        </div>
      )}

      {/* App data grid */}
      {showApp && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Object.keys(appStats).length}, 1fr)`, gap: 4, marginTop: showStats ? 4 : 0 }}>
          {Object.entries(appStats).map(([label, value]) => (
            <GridStat key={label} label={label} value={String(value)} />
          ))}
        </div>
      )}
      {showDoctor && <IntegrationDoctor error={doctor.error} />}

      {/* Uptime bar */}
      {service.uptime != null && showStats && (
        <div style={{ marginTop: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: 0.5 }}>UPTIME 24H</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: service.uptime > 0.99 ? 'var(--green)' : 'var(--amber)' }}>{(service.uptime * 100).toFixed(1)}%</span>
          </div>
          <div style={{ width: '100%', height: 3, background: 'var(--border-color)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 2,
              width: `${Math.min(service.uptime * 100, 100)}%`,
              background: service.uptime > 0.99 ? 'var(--green)' : service.uptime > 0.95 ? 'var(--amber)' : 'var(--red)',
            }} />
          </div>
        </div>
      )}
    </div>
  );
});

// Non-color redundant status cue (WCAG 1.4.1): a distinct shape per state plus
// a screen-reader label, so up/down/unknown never relies on color alone.
//   up → triangle-up, down → triangle-down, unknown → diamond.
function statusCue(isUp, isDown) {
  if (isUp) return { glyph: '▲', label: 'Up' };
  if (isDown) return { glyph: '▼', label: 'Down' };
  return { glyph: '◆', label: 'Unknown' };
}

function StatusDot({ color, isUp, isDown }) {
  const { glyph, label } = statusCue(isUp, isDown);
  return (
    <span
      role="img"
      aria-label={`Status: ${label}`}
      title={label}
      style={{
        flexShrink: 0, lineHeight: 1, fontSize: 9, color,
        textShadow: `0 0 6px ${color}`, fontFamily: 'var(--font-mono)',
      }}
    >
      <span aria-hidden="true">{glyph}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

// Minimal mode shows only icon + name; surface a redundant glyph so status
// is conveyed without color or a badge.
function StatusGlyph({ color, isUp, isDown }) {
  const { glyph, label } = statusCue(isUp, isDown);
  return (
    <span
      role="img"
      aria-label={`Status: ${label}`}
      title={label}
      style={{ flexShrink: 0, lineHeight: 1, fontSize: 10, color, fontFamily: 'var(--font-mono)' }}
    >
      <span aria-hidden="true">{glyph}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

function ServiceIcon({ src, size = 24 }) {
  return (
    <img
      src={src} alt=""
      style={{ width: size, height: size, borderRadius: 6, flexShrink: 0 }}
      onError={e => { e.target.style.display = 'none'; }}
    />
  );
}

// Name + optional "last seen X ago" subtitle (presence breadcrumb). Stacks the
// two lines in a flex column so the subtitle sits directly under the name.
function NameBlock({ service }) {
  const showSubtitle = service.source === 'presence';
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span style={{
        fontFamily: 'var(--font-body)', fontSize: 'var(--fs-service-name)', fontWeight: 500,
        color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{service.name}</span>
      {showSubtitle && (
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{lastSeenLabel(service.lastSeenAt)}</span>
      )}
    </div>
  );
}

// Subtle "unmonitored" pill + nudge tooltip — a running container that matched
// no Kuma monitor. Surfaces the coverage gap without alarming (muted, not amber).
function UnmonitoredTag() {
  return (
    <span
      title="No Uptime Kuma monitor — add one to track this service's true status."
      style={{
        fontFamily: 'var(--font-mono)', fontSize: 9, padding: '2px 6px', borderRadius: 4,
        textTransform: 'uppercase', fontWeight: 500, whiteSpace: 'nowrap',
        background: 'var(--bg-card)', color: 'var(--text-muted)', border: '1px solid var(--border-color)',
      }}
    >unmonitored</span>
  );
}

function BadgeArea({ service, statusStyle, statusColor, isUp, isDown, st, isBreadcrumb, compact }) {
  if (statusStyle === 'minimal') return null;
  // A running, untracked container wears the unmonitored tag. A presence
  // breadcrumb is inherently unmonitored — it shows the "last seen" subtitle
  // instead, so it never double-signals.
  const showUnmonitored = service.monitored === false && !isBreadcrumb;
  if (statusStyle === 'dot') {
    // Dot mode: ping on the right, plus the unmonitored tag if applicable.
    return (
      <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
        {showUnmonitored && <UnmonitoredTag />}
        {service.ping != null && service.ping > 0 && (
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 6px',
            borderRadius: 4, background: 'var(--green-bg)', color: 'var(--green)',
            border: '1px solid var(--green-border)', whiteSpace: 'nowrap',
          }}>{service.ping}ms</span>
        )}
      </div>
    );
  }
  // Badge mode
  return (
    <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
      {showUnmonitored && <UnmonitoredTag />}
      {service.ping != null && service.ping > 0 && (
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: compact ? 9 : 10, padding: '2px 6px',
          borderRadius: 4, background: 'var(--green-bg)', color: 'var(--green)',
          border: '1px solid var(--green-border)', whiteSpace: 'nowrap',
        }}>{service.ping}ms</span>
      )}
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: compact ? 9 : 10, padding: '2px 6px',
        borderRadius: 4, textTransform: 'uppercase', fontWeight: 500, whiteSpace: 'nowrap',
        background: isBreadcrumb ? 'var(--bg-card)' : isUp ? 'var(--green-bg)' : isDown ? 'var(--red-bg)' : 'var(--amber-bg)',
        color: statusColor,
        border: `1px solid ${isBreadcrumb ? 'var(--border-color)' : isUp ? 'var(--green-border)' : isDown ? 'var(--red-border)' : 'var(--amber-border)'}`,
      }}>{st === 'up' ? 'running' : st}</span>
    </div>
  );
}

function CompactStats({ docker }) {
  const parts = [];
  if (docker.cpu != null) parts.push(`${docker.cpu}%`);
  if (docker.memMB != null) parts.push(formatMem(docker.memMB));
  if (!parts.length) return null;
  return (
    <span className="text-mono text-muted" style={{ fontSize: 10, flexShrink: 0 }}>{parts.join(' · ')}</span>
  );
}

function GridStat({ label, value }) {
  return (
    <div className="stat-box" style={{ padding: '5px 3px' }}>
      <div className="stat-label" style={{ marginBottom: 2 }}>{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

// "Why is this dashed?" — when an integration's last fetch failed, the handler
// already caught and REDACTED the error (e.g. "HTTP 401 Unauthorized"); the UI
// used to drop it, leaving mystery dashes. A native <details> keeps it collapsed
// (keyboard + SR accessible for free) until the user asks.
function IntegrationDoctor({ error }) {
  return (
    <details className="svc-doctor">
      <summary className="svc-doctor-summary">
        <span aria-hidden="true">⚠</span> No data — why?
      </summary>
      <div className="svc-doctor-detail">{error}</div>
    </details>
  );
}

function formatMem(mb) {
  if (mb >= 1000) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}
