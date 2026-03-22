import React from 'react';
import ServiceCard from './ServiceCard';

/**
 * NodeCard v8 — Phase 1
 * 
 * Key change: services now arrive pre-merged from the server.
 * Each service object has: name, container, status, uptime, ping, icon, docker, appData
 * No more client-side fuzzy matching or docker data lookups.
 */
export default function NodeCard({ sectionKey, config, setConfig, borderColor, metrics, services, nodeData, children }) {
  const sec = config?.sections?.[sectionKey] || {};

  // Use node data from API for title/subtitle if available, fall back to section config
  const title = nodeData?.display_name || sec.title || sectionKey;
  const subtitle = nodeData?.subtitle || sec.subtitle || '';
  const icon = nodeData?.icon || sec.icon;

  // Per-section background
  const bgStyle = {};
  if (sec.bgColor && sec.bgOpacity > 0) {
    const hex = sec.bgColor;
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    bgStyle.background = `rgba(${r},${g},${b},${sec.bgOpacity})`;
  }

  return (
    <div className="glass-card node-card" style={{ borderTop: `2px solid ${borderColor || 'var(--accent)'}`, ...bgStyle }}>
      <div className="section-header" style={{ cursor: 'grab' }}>
        {icon && (
          <div className="section-icon" style={{
            background: `${borderColor || 'var(--accent)'}15`,
            border: `1px solid ${borderColor || 'var(--accent)'}30`,
          }}>
            {icon}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="section-title">{title}</div>
          {subtitle && <div className="section-subtitle">{subtitle}</div>}
        </div>
      </div>

      {metrics && (
        <div className="node-metrics">
          {metrics.map((m, i) => (
            <div className="metric-block" key={i}>
              <span className="metric-label">{m.label}</span>
              <span className="metric-value" style={{ fontSize: m.small ? 'var(--fs-metric-value-sm)' : 'var(--fs-metric-value)' }}>
                {m.value ?? '—'}
                {m.unit && <span className="metric-unit">{m.unit}</span>}
              </span>
              {m.percent != null && !isNaN(m.percent) && (
                <div className="metric-bar">
                  <div
                    className="metric-bar-fill"
                    style={{
                      width: `${Math.min(m.percent, 100)}%`,
                      background: m.percent > 90 ? 'var(--red)' : m.percent > 70 ? 'var(--amber)' : borderColor || 'var(--accent)',
                    }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {services?.length > 0 && (() => {
        const level = config?.serviceDetailLevel || 'minimal';
        const cols = config?.serviceColumns || 0; // 0 = auto
        const gridCols = cols > 0
          ? `repeat(${cols}, 1fr)`
          : level === 'minimal'
            ? 'repeat(auto-fill, minmax(180px, 1fr))'
            : 'repeat(auto-fill, minmax(200px, 1fr))';
        return (
          <div style={{
            display: 'grid',
            gridTemplateColumns: gridCols,
            gap: 8,
          }}>
            {services.map((s, i) => (
              <ServiceCard
                key={s.container || i}
                service={s}
                level={level}
              />
            ))}
          </div>
        );
      })()}

      {children}
    </div>
  );
}
