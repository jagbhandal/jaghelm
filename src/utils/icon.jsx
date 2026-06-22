import React from 'react';
import { cachedIconUrl } from '../hooks/useData';

// Shared icon helpers: detect emoji strings and render an icon value
// (URL, Dashboard Icons slug, or emoji) as a React node.

/**
 * isEmoji — true when the string is a bare emoji (not a URL or path).
 *
 * Alternation (not a character class) so ZWJ (‍) and variation selector
 * (️) read as repeatable join tokens rather than combining marks on a
 * base char — what no-misleading-character-class flags.
 *
 * @param {string} str
 * @returns {boolean}
 */
export function isEmoji(str) {
  return (
    str &&
    !str.startsWith('http') &&
    !str.startsWith('/') &&
    /^(?:\p{Emoji}|‍|️)+$/u.test(str)
  );
}

/**
 * renderIcon — render an icon value (URL, slug, or emoji) as a React node.
 *
 * @param {string} icon
 * @returns {React.ReactNode}
 */
export function renderIcon(icon) {
  if (!icon) return null;
  if (icon.startsWith('http') || icon.startsWith('/')) {
    return <img src={cachedIconUrl(icon) || icon} alt="" className="icon-img" />;
  }
  if (isEmoji(icon)) {
    return <span style={{ fontSize: 20, lineHeight: 1 }}>{icon}</span>;
  }
  // Treat as a Dashboard Icons slug
  const url = cachedIconUrl(
    `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/${icon}.svg`
  );
  return (
    <img
      src={url}
      alt=""
      className="icon-img"
      onError={(e) => {
        e.target.style.display = 'none';
      }}
    />
  );
}
