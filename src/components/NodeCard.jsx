import React, { useRef, useState, useEffect } from 'react';
import DraggableServiceCard from './DraggableServiceCard';
import { cachedIconUrl } from '../hooks/useData';

/**
 * ServiceGrid — Responsive service card grid with draggable cards
 * 
 * serviceColumns in config is a MAX, not absolute.
 * Uses ResizeObserver to measure actual container width and dynamically
 * adjusts columns: maxCols → maxCols-1 → ... → 1 as the panel shrinks.
 */
function ServiceGrid({ services, config, panelId, dragDisabled }) {
  const gridRef = useRef(null);
  const [cols, setCols] = useState(2);

  const showDocker = config?.showDockerStats !== false;
  const showApp = config?.showAppData !== false;
  const statusStyle = config?.statusStyle || 'badge';
  const cardLayout = config?.cardLayout || 'row';
  const maxCols = config?.serviceColumns || 0; // 0 = auto
  // Different minimum widths per layout mode
  const minColWidth = cardLayout === 'grid' ? 180 : cardLayout === 'list' ? 240 : 280;
  const gap = cardLayout === 'list' ? 0 : 8;

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
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gap,
        minWidth: 0,
        alignItems: 'start',
      }}
    >
      {services.map((s, i) => (
        <DraggableServiceCard
          key={s.uid || s.container || i}
          service={s}
          sourcePanel={panelId}
          showDockerStats={showDocker}
          showAppData={showApp}
          statusStyle={statusStyle}
          cardLayout={cardLayout}
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
export default React.memo(function NodeCard({ sectionKey, config, setConfig, borderColor, metrics, services, nodeData, children, panelId, dragDisabled }) {
  const sec = config?.sections?.[sectionKey] || {};

  const title = nodeData?.display_name || sec.title || sectionKey;
  const subtitle = nodeData?.subtitle || sec.subtitle || '';
  const icon = nodeData?.icon || sec.icon;

  // Check if icon is an emoji (not a URL or slug)
  const isEmoji = (str) => str && !str.startsWith('http') && !str.startsWith('/') && /^[\p{Emoji}\u200d\ufe0f]+$/u.test(str);

  const bgStyle = {};
  if (sec.bgColor && sec.bgOpacity > 0) {
    const hex = sec.bgColor;
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    bgStyle.background = `rgba(${r},${g},${b},${sec.bgOpacity})`;
  }

  return (
    <div className="glass-card node-card" style={{ borderTop: `2px solid ${borderColor || 'var(--accent)'}`, ...bgStyle }}>
      <div className="section-header grab-handle">
        {icon && (
          <div className="section-icon" style={{
            background: `${borderColor || 'var(--accent)'}15`,
            border: `1px solid ${borderColor || 'var(--accent)'}30`,
          }}>
            {icon.startsWith('http') || icon.startsWith('/')
              ? <img src={cachedIconUrl(icon) || icon} alt="" className="icon-img" onError={e => { e.target.style.display = 'none'; }} />
              : isEmoji(icon)
                ? <span style={{ fontSize: 20, lineHeight: 1 }}>{icon}</span>
                : <img src={cachedIconUrl(`https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/${icon}.svg`)} alt="" className="icon-img" onError={e => { e.target.style.display = 'none'; }} />
            }
          </div>
        )}
        <div className="flex-1">
          <div className="section-title">{title}</div>
          {subtitle && <div className="section-subtitle">{subtitle}</div>}
        </div>
      </div>

      {metrics && (
        <div className="node-metrics">
          {metrics.map((m, i) => {
            const valStr = `${m.value ?? '—'}${m.unit || ''}`;
            const autoShrink = valStr.length > 8;
            return (
            <div className="metric-block" key={i}>
              <span className="metric-label">{m.label}</span>
              <span className="metric-value" style={{ fontSize: autoShrink ? 'var(--fs-metric-value-sm)' : m.small ? 'var(--fs-metric-value-sm)' : 'var(--fs-metric-value)' }}>
                {m.value ?? '—'}
                {m.unit && <span className="metric-unit">{m.unit}</span>}
              </span>
              {m.percent != null && !isNaN(m.percent) && (
                <div className="metric-bar">
                  {m.withCachePercent != null && !isNaN(m.withCachePercent) && m.withCachePercent > m.percent ? (
                    <>
                      {/* Stacked bar: actual usage (solid) + cache (striped) */}
                      <div
                        style={{
                          width: `${Math.min(m.percent, 100)}%`,
                          background: m.withCachePercent > 90 ? 'var(--red)' : m.withCachePercent > 70 ? 'var(--amber)' : borderColor || 'var(--accent)',
                          borderRadius: '2px 0 0 2px',
                          position: 'absolute',
                          left: 0, top: 0, height: '100%',
                          transition: 'width 1s ease',
                        }}
                      />
                      <div
                        style={{
                          width: `${Math.min(m.withCachePercent - m.percent, 100 - m.percent)}%`,
                          background: `repeating-linear-gradient(
                            90deg,
                            ${m.withCachePercent > 90 ? 'var(--red)' : m.withCachePercent > 70 ? 'var(--amber)' : borderColor || 'var(--accent)'} 0px,
                            ${m.withCachePercent > 90 ? 'var(--red)' : m.withCachePercent > 70 ? 'var(--amber)' : borderColor || 'var(--accent)'} 2px,
                            transparent 2px,
                            transparent 4px
                          )`,
                          opacity: 0.5,
                          borderRadius: '0 2px 2px 0',
                          position: 'absolute',
                          left: `${m.percent}%`, top: 0, height: '100%',
                          transition: 'width 1s ease, left 1s ease',
                        }}
                      />
                    </>
                  ) : (
                    <div
                      className="metric-bar-fill"
                      style={{
                        width: `${Math.min(m.percent, 100)}%`,
                        background: m.percent > 90 ? 'var(--red)' : m.percent > 70 ? 'var(--amber)' : borderColor || 'var(--accent)',
                      }}
                    />
                  )}
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      {services?.length > 0 && (
        <ServiceGrid services={services} config={config} panelId={panelId || sectionKey} dragDisabled={dragDisabled} />
      )}

      {children}
    </div>
  );
});
