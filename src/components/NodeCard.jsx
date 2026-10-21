import React, { useRef, useState, useEffect } from 'react';
import DraggableServiceCard from './DraggableServiceCard';
import { useConfig } from '../context/ConfigContext.jsx';
import { isEmoji, iconImageSrc } from '../utils/icon.jsx';

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
 * NodeCard — a dashboard section: header and a draggable service grid.
 * Service cards are draggable between panels when dragDisabled is false. A
 * node's readings are the Overview's Infrastructure section's (#299), so the
 * card draws none.
 */
export default React.memo(function NodeCard({
  sectionKey,
  borderColor,
  services,
  nodeData,
  children,
  panelId,
  dragDisabled,
  banner,
}) {
  const { config } = useConfig();
  const sec = config?.sections?.[sectionKey] || {};

  const title = nodeData?.display_name || sec.title || sectionKey;
  const subtitle = nodeData?.subtitle || sec.subtitle || '';
  const icon = nodeData?.icon || sec.icon;

  const bgStyle = {};
  if (sec.bgColor && sec.bgOpacity > 0) {
    const hex = sec.bgColor;
    const r = parseInt(hex.slice(1, 3), 16),
      g = parseInt(hex.slice(3, 5), 16),
      b = parseInt(hex.slice(5, 7), 16);
    bgStyle.background = `rgba(${r},${g},${b},${sec.bgOpacity})`;
  }

  return (
    <div
      className="glass-card node-card"
      style={{ borderTop: `2px solid ${borderColor || 'var(--accent)'}`, ...bgStyle }}
    >
      <div className="section-header grab-handle">
        {icon && (
          <div
            className="section-icon"
            style={{
              background: `${borderColor || 'var(--accent)'}15`,
              border: `1px solid ${borderColor || 'var(--accent)'}30`,
            }}
          >
            {isEmoji(icon) ? (
              <span style={{ fontSize: 20, lineHeight: 1 }}>{icon}</span>
            ) : (
              <img
                src={iconImageSrc(icon)}
                alt=""
                className="icon-img"
                onError={(e) => {
                  e.target.style.display = 'none';
                }}
              />
            )}
          </div>
        )}
        <div className="flex-1">
          <div className="section-title">{title}</div>
          {subtitle && <div className="section-subtitle">{subtitle}</div>}
        </div>
      </div>

      {/* Per-panel degraded/stale notice — sits between the header and the
          services so it can't be confused with a service row. Null when healthy,
          keeping the happy path visually unchanged. */}
      {banner}

      {services?.length > 0 && (
        <ServiceGrid
          services={services}
          config={config}
          panelId={panelId || sectionKey}
          dragDisabled={dragDisabled}
        />
      )}

      {children}
    </div>
  );
});
