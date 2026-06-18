import React, { useRef, useState, useEffect } from 'react';
import DraggableServiceCard from './DraggableServiceCard';
import { cachedIconUrl } from '../hooks/useData';
import { useConfig } from '../context/ConfigContext.jsx';
import { usageSeverity, cardSeverity, severityColor, severityLabel } from '../utils/thresholds.js';
import Sparkline from './Sparkline';

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
export default React.memo(function NodeCard({
  sectionKey,
  borderColor,
  metrics,
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

  // Pre-attentive emphasis: if any metric's real usage is elevated/critical,
  // halo the whole card so trouble jumps off the board before you read it.
  const halo = cardSeverity(metrics);

  // Check if icon is an emoji (not a URL or slug).
  // Alternation (not a character class) so ZWJ (\u200d) and variation selector
  // (\ufe0f) read as repeatable join tokens, not as combining marks on a base
  // char \u2014 which is what no-misleading-character-class flags. Behaviour is
  // identical to the prior class form; this just makes the intent explicit.
  const isEmoji = (str) =>
    str &&
    !str.startsWith('http') &&
    !str.startsWith('/') &&
    /^(?:\p{Emoji}|\u200d|\ufe0f)+$/u.test(str);

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
      className={`glass-card node-card${halo ? ` node-card--${halo}` : ''}`}
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
            {icon.startsWith('http') || icon.startsWith('/') ? (
              <img
                src={cachedIconUrl(icon) || icon}
                alt=""
                className="icon-img"
                onError={(e) => {
                  e.target.style.display = 'none';
                }}
              />
            ) : isEmoji(icon) ? (
              <span style={{ fontSize: 20, lineHeight: 1 }}>{icon}</span>
            ) : (
              <img
                src={cachedIconUrl(
                  `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/${icon}.svg`
                )}
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
          metrics so it can't be confused with a service row. Null when healthy,
          keeping the happy path visually unchanged. */}
      {banner}

      {metrics && (
        <div className="node-metrics">
          {metrics.map((m, i) => {
            const valStr = `${m.value ?? '—'}${m.unit || ''}`;
            const autoShrink = valStr.length > 8;
            // Tint the value itself (not just the bar) by real usage, with an
            // SR-only label so the cue is never color-only (WCAG 1.4.1).
            const sev = usageSeverity(m.percent);
            const sevLabel = severityLabel(sev);
            const accent = borderColor || 'var(--accent)';
            const barColor = severityColor(sev, accent); // non-cache bar (real usage)
            const cacheColor = severityColor(usageSeverity(m.withCachePercent), accent); // stacked bar
            return (
              <div className="metric-block" key={i}>
                <span className="metric-label">{m.label}</span>
                <span
                  className="metric-value"
                  style={{
                    fontSize: autoShrink
                      ? 'var(--fs-metric-value-sm)'
                      : m.small
                        ? 'var(--fs-metric-value-sm)'
                        : 'var(--fs-metric-value)',
                    // Tint the VALUE only for critical (red passes contrast on
                    // every theme). Amber as large value-text fails the 3:1
                    // large-text floor on light themes — warn still reads via the
                    // bar, the card halo, and the SR label below.
                    color: sev === 'critical' ? 'var(--red)' : undefined,
                  }}
                >
                  {m.value ?? '—'}
                  {m.unit && <span className="metric-unit">{m.unit}</span>}
                  {sevLabel && <span className="sr-only"> ({sevLabel})</span>}
                </span>
                {/* Glance-context trend: the last ~1h of this usage %, colored by
                    severity (muted normally). Decorative + aria-hidden. */}
                {m.history && m.history.length >= 2 && (
                  <Sparkline
                    data={m.history}
                    color={severityColor(sev, 'var(--text-muted)')}
                    className="metric-sparkline"
                  />
                )}
                {m.percent != null && !isNaN(m.percent) && (
                  <div className="metric-bar">
                    {m.withCachePercent != null &&
                    !isNaN(m.withCachePercent) &&
                    m.withCachePercent > m.percent ? (
                      <>
                        {/* Stacked bar: actual usage (solid) + cache (striped) */}
                        <div
                          style={{
                            width: `${Math.min(m.percent, 100)}%`,
                            background: cacheColor,
                            borderRadius: '2px 0 0 2px',
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            height: '100%',
                            transition: 'width 1s ease',
                          }}
                        />
                        <div
                          style={{
                            width: `${Math.min(m.withCachePercent - m.percent, 100 - m.percent)}%`,
                            background: `repeating-linear-gradient(
                            90deg,
                            ${cacheColor} 0px,
                            ${cacheColor} 2px,
                            transparent 2px,
                            transparent 4px
                          )`,
                            opacity: 0.5,
                            borderRadius: '0 2px 2px 0',
                            position: 'absolute',
                            left: `${m.percent}%`,
                            top: 0,
                            height: '100%',
                            transition: 'width 1s ease, left 1s ease',
                          }}
                        />
                      </>
                    ) : (
                      <div
                        className="metric-bar-fill"
                        style={{
                          width: `${Math.min(m.percent, 100)}%`,
                          background: barColor,
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
