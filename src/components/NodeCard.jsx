import React, { useRef, useState, useEffect } from 'react';
import DraggableServiceCard from './DraggableServiceCard';

/**
 * ServiceGrid — Responsive service card grid with draggable cards
 * 
 * serviceColumns in config is a MAX, not absolute.
 * Uses ResizeObserver to measure actual container width and dynamically
 * adjusts columns: maxCols → maxCols-1 → ... → 1 as the panel shrinks.
 */
function ServiceGrid({ services, config, panelId, dragDisabled }) {
  const gridRef = useRef(null);
  const [cols, setCols] = useState(4);

  const showDocker = config?.showDockerStats !== false;
  const showApp = config?.showAppData !== false;
  const hasDetails = showDocker || showApp;
  const maxCols = config?.serviceColumns || 0; // 0 = auto (unlimited)
  const minColWidth = hasDetails ? 200 : 180;
  const gap = 8;

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;

    const calc = () => {
      const w = el.clientWidth;
      if (w <= 0) return;
      const fitCols = Math.max(1, Math.floor((w + gap) / (minColWidth + gap)));
      setCols(maxCols > 0 ? Math.min(maxCols, fitCols) : fitCols);
    };

    calc();

    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxCols, minColWidth, gap]);

  return (
    <div
      ref={gridRef}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap,
      }}
    >
      {services.map((s, i) => (
        <DraggableServiceCard
          key={s.container || i}
          service={s}
          sourcePanel={panelId}
          showDockerStats={showDocker}
          showAppData={showApp}
          disabled={dragDisabled}
        />
      ))}
    </div>
  );
}

/**
 * NodeCard v8 — Phase 4
 * 
 * Now accepts panelId and dragDisabled props for drag-and-drop support.
 * Service cards are draggable between panels when dragDisabled is false.
 */
export default function NodeCard({ sectionKey, config, setConfig, borderColor, metrics, services, nodeData, children, panelId, dragDisabled }) {
  const sec = config?.sections?.[sectionKey] || {};

  const title = nodeData?.display_name || sec.title || sectionKey;
  const subtitle = nodeData?.subtitle || sec.subtitle || '';
  const icon = nodeData?.icon || sec.icon;

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
            {icon.startsWith('http') || icon.startsWith('/')
              ? <img src={icon} alt="" style={{ width: 22, height: 22, borderRadius: 4 }} onError={e => { e.target.style.display = 'none'; }} />
              : <img src={`https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/${icon}.svg`} alt="" style={{ width: 22, height: 22, borderRadius: 4 }} onError={e => { e.target.style.display = 'none'; }} />
            }
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

      {services?.length > 0 && (
        <ServiceGrid services={services} config={config} panelId={panelId || sectionKey} dragDisabled={dragDisabled} />
      )}

      {children}
    </div>
  );
}
