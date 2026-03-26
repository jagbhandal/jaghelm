import React from 'react';
import { getServiceIcon } from '../hooks/useData';

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
  const statusColor = isUp ? 'var(--green)' : isDown ? 'var(--red)' : 'var(--amber)';

  const docker = service.docker || {};
  const showStats = showDockerStats && (docker.cpu != null || docker.memMB != null);
  const appData = service.appData;
  const showApp = showAppData && appData && Object.keys(appData).length > 0;
  const showBorder = statusStyle !== 'minimal';

  // ── Layout: List — clean rows, no card background ──
  if (cardLayout === 'list') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 4px',
        borderBottom: '1px solid var(--border-color)',
        minWidth: 0,
      }}>
        {statusStyle === 'dot' && <StatusDot color={statusColor} />}
        {icon && <ServiceIcon src={icon} size={20} />}
        <span style={{
          fontFamily: 'var(--font-body)', fontSize: 'var(--fs-service-name)', fontWeight: 500,
          color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{service.name}</span>
        {showStats && <CompactStats docker={docker} />}
        <BadgeArea service={service} statusStyle={statusStyle} statusColor={statusColor} isUp={isUp} isDown={isDown} st={st} />
      </div>
    );
  }

  // ── Layout: Row — subtle card background, JagHelm signature ──
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
          {statusStyle === 'dot' && <StatusDot color={statusColor} />}
          {icon && <ServiceIcon src={icon} size={24} />}
          <span style={{
            fontFamily: 'var(--font-body)', fontSize: 'var(--fs-service-name)', fontWeight: 500,
            color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{service.name}</span>
          <BadgeArea service={service} statusStyle={statusStyle} statusColor={statusColor} isUp={isUp} isDown={isDown} st={st} />
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
            gridTemplateColumns: `repeat(${Object.keys(appData).length}, 1fr)`,
            gap: 6, marginTop: 8, paddingTop: 8,
            borderTop: '1px solid var(--border-color)',
          }}>
            {Object.entries(appData).map(([label, value]) => (
              <GridStat key={label} label={label} value={String(value)} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Layout: Grid — denser card boxes (original compact style) ──
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
        {statusStyle === 'dot' && <StatusDot color={statusColor} />}
        {icon && <ServiceIcon src={icon} size={20} />}
        <span style={{
          fontFamily: 'var(--font-body)', fontSize: 'var(--fs-service-name)', fontWeight: 500,
          color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{service.name}</span>
        <BadgeArea service={service} statusStyle={statusStyle} statusColor={statusColor} isUp={isUp} isDown={isDown} st={st} compact />
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
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Object.keys(appData).length}, 1fr)`, gap: 4, marginTop: showStats ? 4 : 0 }}>
          {Object.entries(appData).map(([label, value]) => (
            <GridStat key={label} label={label} value={String(value)} />
          ))}
        </div>
      )}

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

// ─── Shared sub-components ───────────────────────────────────────────────────

function StatusDot({ color }) {
  return (
    <div style={{
      width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
      background: color, boxShadow: `0 0 6px ${color}`,
    }} />
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

function BadgeArea({ service, statusStyle, statusColor, isUp, isDown, st, compact }) {
  if (statusStyle === 'minimal') return null;
  if (statusStyle === 'dot') {
    // Dot mode: just ping on the right
    if (service.ping != null && service.ping > 0) {
      return (
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 6px',
          borderRadius: 4, background: 'var(--green-bg)', color: 'var(--green)',
          border: '1px solid var(--green-border)', flexShrink: 0, whiteSpace: 'nowrap',
        }}>{service.ping}ms</span>
      );
    }
    return null;
  }
  // Badge mode
  return (
    <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
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
        background: isUp ? 'var(--green-bg)' : isDown ? 'var(--red-bg)' : 'var(--amber-bg)',
        color: statusColor,
        border: `1px solid ${isUp ? 'var(--green-border)' : isDown ? 'var(--red-border)' : 'var(--amber-border)'}`,
      }}>{st === 'up' ? 'running' : st}</span>
    </div>
  );
}

function InlineStat({ label, value }) {
  if (value == null) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
      <span className="stat-label" style={{ fontSize: 9 }}>{label}</span>
      <span className="stat-value" style={{ fontSize: 12 }}>{value}</span>
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

function formatMem(mb) {
  if (mb >= 1000) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}
