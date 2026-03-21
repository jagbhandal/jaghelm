import React from 'react';
import { getServiceIcon } from '../hooks/useData';

/**
 * ServiceCard v8 — Phase 1
 * 
 * Key change: service object now arrives fully merged from the server.
 * Props shape: { name, container, status, uptime, ping, icon, docker: { cpu, memMB, rxMB, txMB }, appData: { ... } | null }
 * No more client-side fuzzy matching of docker data or app data.
 */
export default function ServiceCard({ service, level }) {
  // Icon: use server-provided icon key, fall back to name-based icon lookup
  const icon = service.icon
    ? getServiceIcon(service.icon) || getServiceIcon(service.name)
    : getServiceIcon(service.name);

  const st = service.status || 'unknown';
  const isUp = st === 'up';
  const isDown = st === 'down';
  const statusColor = isUp ? 'var(--green)' : isDown ? 'var(--red)' : 'var(--amber)';

  const docker = service.docker || {};
  const showStats = level === 'stats' || level === 'full';
  const appData = service.appData;
  const showApp = level === 'full' && appData && Object.keys(appData).length > 0;

  return (
    <div style={{
      background: 'var(--bg-card-inner)', border: '1px solid var(--border-color)',
      borderRadius: 12, padding: showStats ? '12px 14px' : '8px 12px',
      transition: 'border-color 0.2s', cursor: 'default',
      borderLeft: `3px solid ${statusColor}`, borderLeftStyle: 'solid',
    }}>
      {/* Header row: icon + name + status badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: showStats ? 8 : 0 }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: statusColor, boxShadow: `0 0 6px ${statusColor}`,
        }} />
        {icon && <img src={icon} alt="" style={{ width: 20, height: 20, borderRadius: 4, flexShrink: 0 }} />}
        <span style={{
          fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500,
          flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {service.name}
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          {service.ping != null && service.ping > 0 && (
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 6px',
              borderRadius: 4, background: 'var(--green-bg)', color: 'var(--green)',
              border: '1px solid var(--green-border)',
            }}>{service.ping}ms</span>
          )}
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 6px',
            borderRadius: 4, textTransform: 'uppercase', fontWeight: 500,
            background: isUp ? 'var(--green-bg)' : isDown ? 'var(--red-bg)' : 'var(--amber-bg)',
            color: statusColor,
            border: `1px solid ${isUp ? 'var(--green-border)' : isDown ? 'var(--red-border)' : 'var(--amber-border)'}`,
          }}>{st === 'up' ? 'running' : st}</span>
        </div>
      </div>

      {/* Stats row: CPU, MEM, RX, TX */}
      {showStats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))', gap: 6, marginTop: 4 }}>
          <StatCell label="CPU" value={docker.cpu != null ? `${docker.cpu}%` : '—'} />
          <StatCell label="MEM" value={docker.memMB != null ? `${docker.memMB} MB` : '—'} />
          <StatCell label="RX" value={docker.rxMB != null ? `${docker.rxMB} MB` : '—'} />
          <StatCell label="TX" value={docker.txMB != null ? `${docker.txMB} MB` : '—'} />
        </div>
      )}

      {/* App-specific stats (Tier 3) */}
      {showApp && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))', gap: 6, marginTop: 6 }}>
          {Object.entries(appData).map(([label, value]) => (
            <StatCell key={label} label={label} value={String(value)} />
          ))}
        </div>
      )}

      {/* Uptime bar */}
      {service.uptime != null && showStats && (
        <div style={{ marginTop: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: 0.5 }}>UPTIME 24H</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--green)' }}>{(service.uptime * 100).toFixed(1)}%</span>
          </div>
          <div style={{ width: '100%', height: 3, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 2,
              width: `${Math.min(service.uptime * 100, 100)}%`,
              background: service.uptime > 0.99 ? 'var(--green)' : service.uptime > 0.95 ? 'var(--amber)' : 'var(--red)',
              transition: 'width 1s ease',
            }} />
          </div>
        </div>
      )}
    </div>
  );
}

function StatCell({ label, value }) {
  return (
    <div style={{
      textAlign: 'center', padding: '6px 4px',
      background: 'rgba(255,255,255,0.02)', borderRadius: 6,
      border: '1px solid rgba(255,255,255,0.03)',
    }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.2 }}>{value}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: 1, textTransform: 'uppercase', marginTop: 2 }}>{label}</div>
    </div>
  );
}
