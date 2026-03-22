import React from 'react';
import { getServiceIcon } from '../hooks/useData';

export function UPSCard({ upsData, borderColor, config }) {
  const sec = config?.sections?.ups || {};
  // nut_status values: 0=Unknown, 1=Online (OL), 2=On Battery (OB), 3=Low Battery (LB)
  const sL = (v) => v == null ? 'Unknown' : v === 1 ? 'Online' : v === 2 ? 'On Battery' : v === 3 ? 'Low Battery' : v === 0 ? 'Unknown' : `Status ${v}`;
  const sC = (v) => v === 1 ? 'var(--green)' : v === 2 ? 'var(--amber)' : v === 3 ? 'var(--red)' : 'var(--text-muted)';
  const rt = upsData?.runtime ? Math.floor(upsData.runtime / 60) : null;
  return (
    <div className="glass-card node-card" style={{ borderTop: `2px solid ${borderColor || 'var(--green)'}` }}>
      <div className="section-header" style={{ cursor: 'grab' }}>
        <div className="section-icon" style={{ background: `${borderColor}15`, border: `1px solid ${borderColor}30` }}>{sec.icon || '⚡'}</div>
        <div><div className="section-title">{sec.title || 'UPS Power'}</div><div className="section-subtitle">{sec.subtitle || 'APC Back-UPS ES 600M1'}</div></div>
      </div>
      <div className="ups-grid">
        <div className="metric-block"><span className="metric-label">Status</span><span className="metric-value" style={{ fontSize: 18, color: upsData?.status != null ? sC(upsData.status) : 'var(--text-muted)' }}>{sL(upsData?.status)}</span></div>
        <div className="metric-block"><span className="metric-label">Battery</span><span className="metric-value">{upsData?.charge != null ? Math.round(upsData.charge) : '—'}<span className="metric-unit">%</span></span>{upsData?.charge != null && <div className="metric-bar"><div className="metric-bar-fill" style={{ width: `${upsData.charge}%`, background: upsData.charge > 50 ? 'var(--green)' : 'var(--amber)' }} /></div>}</div>
        <div className="metric-block"><span className="metric-label">Runtime</span><span className="metric-value" style={{ fontSize: 18 }}>{rt != null ? `${rt} min` : '—'}</span></div>
        <div className="metric-block"><span className="metric-label">Load</span><span className="metric-value">{upsData?.load != null ? Math.round(upsData.load) : '—'}<span className="metric-unit">%</span></span>{upsData?.load != null && <div className="metric-bar"><div className="metric-bar-fill" style={{ width: `${upsData.load}%`, background: upsData.load > 80 ? 'var(--red)' : 'var(--green)' }} /></div>}</div>
      </div>
    </div>
  );
}

export function GiteaActivity({ commits, config }) {
  const sec = config?.sections?.pipeline || {};
  const ago = (d) => { if (!d) return ''; const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000); return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s/60)}m` : s < 86400 ? `${Math.floor(s/3600)}h` : `${Math.floor(s/86400)}d`; };
  return (
    <div className="glass-card node-card" style={{ borderTop: '2px solid var(--accent)' }}>
      <div className="section-header" style={{ cursor: 'grab' }}>
        <div className="section-icon" style={{ background: 'var(--accent-glow)', border: '1px solid rgba(99,102,241,0.2)' }}>{sec.icon || '🔄'}</div>
        <div><div className="section-title">{sec.title || 'Pipeline Activity'}</div><div className="section-subtitle">{sec.subtitle || 'homelab-infra'}</div></div>
      </div>
      {(commits || []).slice(0, 5).map((c, i) => <div className="commit-row" key={i}><span className="commit-sha">{c.sha}</span><span className="commit-msg">{c.message}</span><span className="commit-time">{ago(c.date)}</span></div>)}
      {(!commits || !commits.length) && <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 8 }}>No recent commits</div>}
    </div>
  );
}

export function QuickLaunch({ config, borderColor }) {
  const sec = config?.sections?.quicklaunch || {};
  const groups = [{ key: 'personal', label: 'Personal' }, { key: 'management', label: 'Management' }, { key: 'devops', label: 'Dev & Monitoring' }];
  return (
    <div className="glass-card node-card" style={{ borderTop: `2px solid ${borderColor || 'var(--blue)'}` }}>
      <div className="section-header" style={{ cursor: 'grab' }}>
        <div className="section-icon" style={{ background: `${borderColor}15`, border: `1px solid ${borderColor}30` }}>{sec.icon || '🚀'}</div>
        <div><div className="section-title">{sec.title || 'Quick Launch'}</div></div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {groups.map(g => {
          const links = config.links?.[g.key] || [];
          if (links.length === 0) return null;
          return (
            <div key={g.key}>
              <h4 style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>{g.label}</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                {links.map((l, i) => {
                  const svgIcon = getServiceIcon(l.name);
                  return (
                    <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" className="quick-launch-link">
                      {svgIcon
                        ? <img src={svgIcon} alt="" style={{ width: 20, height: 20, borderRadius: 4, flexShrink: 0 }} />
                        : <span style={{ fontSize: 18, width: 22, textAlign: 'center' }}>{l.icon}</span>
                      }
                      <span>{l.name}</span>
                    </a>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
