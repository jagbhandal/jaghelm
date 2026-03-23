import React from 'react';
import { getServiceIcon } from '../hooks/useData';

/**
 * ServiceCard v9 — Horizontal row design
 *
 * Inspired by Homepage's spacious horizontal layout, styled with JagHelm's
 * glass card aesthetic and accent system.
 *
 * Three status styles (configurable in Settings > Layout):
 *   dot     — colored left border + status dot (default)
 *   badge   — colored left border + ping/status badges right-aligned
 *   minimal — icon + name only, no status indicators
 *
 * Docker stats and app data appear as additional rows when enabled in settings.
 */
export default function ServiceCard({ service, showDockerStats = true, showAppData = true, statusStyle = 'badge' }) {
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

  return (
    <div style={{
      background: 'var(--bg-card-inner)',
      border: '1px solid var(--border-color)',
      borderRadius: 10,
      borderLeft: showBorder ? `3px solid ${statusColor}` : '1px solid var(--border-color)',
      padding: '10px 14px',
      transition: 'border-color 0.2s, background 0.2s',
      overflow: 'hidden',
      minWidth: 0,
    }}>
      {/* ── Primary row: icon + name + badges ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Status dot (only in dot mode) */}
        {statusStyle === 'dot' && (
          <div style={{
            width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
            background: statusColor, boxShadow: `0 0 6px ${statusColor}`,
          }} />
        )}

        {/* Service icon */}
        {icon && (
          <img
            src={icon} alt=""
            style={{ width: 24, height: 24, borderRadius: 6, flexShrink: 0 }}
            onError={e => { e.target.style.display = 'none'; }}
          />
        )}

        {/* Service name */}
        <span style={{
          fontFamily: 'var(--font-body)',
          fontSize: 'var(--fs-service-name)',
          fontWeight: 500,
          color: 'var(--text-primary)',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {service.name}
        </span>

        {/* Right side: ping + status badges (badge mode) */}
        {statusStyle === 'badge' && (
          <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
            {service.ping != null && service.ping > 0 && (
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 6px',
                borderRadius: 4, background: 'var(--green-bg)', color: 'var(--green)',
                border: '1px solid var(--green-border)', whiteSpace: 'nowrap',
              }}>{service.ping}ms</span>
            )}
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 6px',
              borderRadius: 4, textTransform: 'uppercase', fontWeight: 500, whiteSpace: 'nowrap',
              background: isUp ? 'var(--green-bg)' : isDown ? 'var(--red-bg)' : 'var(--amber-bg)',
              color: statusColor,
              border: `1px solid ${isUp ? 'var(--green-border)' : isDown ? 'var(--red-border)' : 'var(--amber-border)'}`,
            }}>{st === 'up' ? 'running' : st}</span>
          </div>
        )}

        {/* Right side: just a dot (dot mode) — the dot is on the left, ping on right */}
        {statusStyle === 'dot' && service.ping != null && service.ping > 0 && (
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 6px',
            borderRadius: 4, background: 'var(--green-bg)', color: 'var(--green)',
            border: '1px solid var(--green-border)', flexShrink: 0, whiteSpace: 'nowrap',
          }}>{service.ping}ms</span>
        )}
      </div>

      {/* ── Docker stats row ── */}
      {showStats && (
        <div style={{
          display: 'flex', gap: 12, marginTop: 8, paddingTop: 8,
          borderTop: '1px solid rgba(255,255,255,0.04)',
          flexWrap: 'wrap',
        }}>
          <InlineStat label="CPU" value={docker.cpu != null ? `${docker.cpu}%` : null} />
          <InlineStat label="MEM" value={docker.memMB != null ? formatMem(docker.memMB) : null} />
          <InlineStat label="RX" value={docker.rxMB != null ? formatMem(docker.rxMB) : null} />
          <InlineStat label="TX" value={docker.txMB != null ? formatMem(docker.txMB) : null} />
          {service.uptime != null && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: 0.5 }}>24H</span>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500,
                color: service.uptime > 0.99 ? 'var(--green)' : service.uptime > 0.95 ? 'var(--amber)' : 'var(--red)',
              }}>{(service.uptime * 100).toFixed(1)}%</span>
            </div>
          )}
        </div>
      )}

      {/* ── App integration data row ── */}
      {showApp && (
        <div style={{
          display: 'flex', gap: 12, marginTop: 8, paddingTop: 8,
          borderTop: '1px solid rgba(255,255,255,0.04)',
          flexWrap: 'wrap',
        }}>
          {Object.entries(appData).map(([label, value]) => (
            <InlineStat key={label} label={label} value={String(value)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Inline stat — label:value pair, compact horizontal display */
function InlineStat({ label, value }) {
  if (value == null) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)',
        letterSpacing: 0.5, textTransform: 'uppercase',
      }}>{label}</span>
      <span style={{
        fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600,
        color: 'var(--text-primary)',
      }}>{value}</span>
    </div>
  );
}

/** Format memory — show MB below 1000, GB above */
function formatMem(mb) {
  if (mb >= 1000) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}
