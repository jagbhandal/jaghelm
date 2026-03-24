import React from 'react';
import { getServiceIcon, cachedIconUrl } from '../hooks/useData';

// Shared: render icon (URL, slug, or emoji)
function isEmoji(str) {
  return str && !str.startsWith('http') && !str.startsWith('/') && /^[\p{Emoji}\u200d\ufe0f]+$/u.test(str);
}

function renderIcon(icon) {
  if (!icon) return null;
  if (icon.startsWith('http') || icon.startsWith('/')) {
    return <img src={cachedIconUrl(icon) || icon} alt="" className="icon-img" />;
  }
  if (isEmoji(icon)) {
    return <span style={{ fontSize: 20, lineHeight: 1 }}>{icon}</span>;
  }
  // Treat as a Dashboard Icons slug
  const url = cachedIconUrl(`https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/${icon}.svg`);
  return <img src={url} alt="" className="icon-img" onError={e => { e.target.style.display = 'none'; }} />;
}

// Shared: compute background style from section config
function sectionBgStyle(sec) {
  if (sec?.bgColor && (sec.bgOpacity ?? 0) > 0) {
    const hex = sec.bgColor;
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return { background: `rgba(${r},${g},${b},${sec.bgOpacity})` };
  }
  return {};
}

export const UPSCard = React.memo(function UPSCard({ upsData, borderColor, config }) {
  const sec = config?.sections?.ups || {};
  // nut_status values: 0=Unknown, 1=Online (OL), 2=On Battery (OB), 3=Low Battery (LB)
  const sL = (v) => v == null ? 'Unknown' : v === 1 ? 'Online' : v === 2 ? 'On Battery' : v === 3 ? 'Low Battery' : v === 0 ? 'Unknown' : `Status ${v}`;
  const sC = (v) => v === 1 ? 'var(--green)' : v === 2 ? 'var(--amber)' : v === 3 ? 'var(--red)' : 'var(--text-muted)';
  const rt = upsData?.runtime ? Math.floor(upsData.runtime / 60) : null;
  return (
    <div className="glass-card node-card" style={{ borderTop: `2px solid ${borderColor || 'var(--green)'}`, ...sectionBgStyle(sec) }}>
      <div className="section-header grab-handle">
        <div className="section-icon" style={{ background: `${borderColor}15`, border: `1px solid ${borderColor}30` }}>{renderIcon(sec.icon || '⚡')}</div>
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
});

export const GiteaActivity = React.memo(function GiteaActivity({ commits, config }) {
  const sec = config?.sections?.pipeline || {};
  const ago = (d) => {
    if (!d) return '';
    const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
    return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
  };

  // Support both old format (flat array of commits) and new format (array of { repo, commits })
  const isMultiRepo = Array.isArray(commits) && commits.length > 0 && commits[0]?.repo;
  const repoGroups = isMultiRepo ? commits : [];
  const flatCommits = !isMultiRepo ? (commits || []) : [];

  return (
    <div className="glass-card node-card" style={{ borderTop: '2px solid var(--accent)', ...sectionBgStyle(sec) }}>
      <div className="section-header grab-handle">
        <div className="section-icon" style={{ background: 'var(--accent-glow)', border: '1px solid rgba(99,102,241,0.2)' }}>{renderIcon(sec.icon || 'gitea')}</div>
        <div>
          <div className="section-title">{sec.title || 'Pipeline Activity'}</div>
          {!isMultiRepo && <div className="section-subtitle">{sec.subtitle || ''}</div>}
        </div>
      </div>

      {/* Multi-repo layout */}
      {isMultiRepo && repoGroups.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {repoGroups.map((group, gi) => (
            <div key={group.repo || gi}>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)',
                letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6, paddingLeft: 2,
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)',
                  display: 'inline-block', flexShrink: 0,
                }} />
                {group.repo}
              </div>
              {group.commits.slice(0, 5).map((c, i) => (
                <div className="commit-row" key={`${gi}-${i}`}>
                  <span className="commit-sha">{c.sha}</span>
                  <span className="commit-msg">{c.message}</span>
                  <span className="commit-time">{ago(c.date)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Legacy flat layout (backward compat) */}
      {!isMultiRepo && flatCommits.length > 0 && flatCommits.slice(0, 5).map((c, i) => (
        <div className="commit-row" key={i}>
          <span className="commit-sha">{c.sha}</span>
          <span className="commit-msg">{c.message}</span>
          <span className="commit-time">{ago(c.date)}</span>
        </div>
      ))}

      {/* Empty state */}
      {(isMultiRepo ? repoGroups.length === 0 : flatCommits.length === 0) && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 8 }}>No recent commits</div>
      )}
    </div>
  );
});

const CDN_BASE = 'https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/svg';

// Resolve best icon URL for a quick launch link
function resolveQuickLinkIcon(link) {
  // 1. If link has an icon field that looks like a CDN slug, use it directly
  if (link.icon && /^[a-z0-9-]+$/i.test(link.icon)) {
    return cachedIconUrl(`${CDN_BASE}/${link.icon.toLowerCase()}.svg`);
  }
  // 2. If link.icon is a full URL, route through cache
  if (link.icon && (link.icon.startsWith('http') || link.icon.startsWith('/'))) {
    return cachedIconUrl(link.icon) || link.icon;
  }
  // 3. Try getServiceIcon by name (already routes through cache)
  const mapped = getServiceIcon(link.name);
  if (mapped) return mapped;
  // 4. Try the link name directly as a CDN slug
  const slug = (link.name || '').toLowerCase().replace(/\s+/g, '-');
  if (slug) return cachedIconUrl(`${CDN_BASE}/${slug}.svg`);
  return null;
}

export const QuickLaunch = React.memo(function QuickLaunch({ config, borderColor }) {
  const sec = config?.sections?.quicklaunch || {};
  const groups = [{ key: 'personal', label: 'Personal' }, { key: 'management', label: 'Management' }, { key: 'devops', label: 'Dev & Monitoring' }];
  return (
    <div className="glass-card node-card" style={{ borderTop: `2px solid ${borderColor || 'var(--blue)'}`, ...sectionBgStyle(sec) }}>
      <div className="section-header grab-handle">
        <div className="section-icon" style={{ background: `${borderColor}15`, border: `1px solid ${borderColor}30` }}>{renderIcon(sec.icon || '🚀')}</div>
        <div><div className="section-title">{sec.title || 'Quick Launch'}</div></div>
      </div>
      <div className="settings-stack" style={{ gap: 12 }}>
        {groups.map(g => {
          const links = config.links?.[g.key] || [];
          if (links.length === 0) return null;
          return (
            <div key={g.key}>
              <h4 style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>{g.label}</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {links.map((l, i) => {
                  const iconUrl = resolveQuickLinkIcon(l);
                  return (
                    <a key={i} href={l.url} target={config.linkTarget || '_blank'} rel="noopener noreferrer" className="quick-launch-link">
                      <img
                        src={iconUrl}
                        alt=""
                        className="icon-img-sm"
                        onError={e => { e.target.style.display = 'none'; }}
                      />
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
});
