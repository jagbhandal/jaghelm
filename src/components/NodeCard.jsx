import React from 'react';
import { useConfig } from '../context/ConfigContext.jsx';
import { isEmoji, iconImageSrc } from '../utils/icon.jsx';

/**
 * NodeCard — a node's panel on today's board: its header and what it is given
 * (the node's Proxmox lists). A node's readings are the Overview's
 * Infrastructure section's (#299) and its services the Services section's
 * (#300), so the card draws neither.
 */
export default React.memo(function NodeCard({
  sectionKey,
  borderColor,
  nodeData,
  children,
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

      {/* Per-panel degraded/stale notice, under the header. Null when healthy,
          keeping the happy path visually unchanged. */}
      {banner}

      {children}
    </div>
  );
});
