import React from 'react';
import { cachedIconUrl } from '../hooks/useData';

// Shared icon helpers: detect emoji strings and render an icon value
// (URL, Dashboard Icons slug, or emoji) as a React node.

// Canonical Dashboard Icons CDN base. The repo moved from walkxcode to
// homarr-labs; pin every slug URL here so all call sites resolve the same
// way (avoids slug 404s where one base lags behind the other).
export const ICON_CDN_BASE =
  'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg';

/**
 * iconSlugUrl — build the Dashboard Icons SVG URL for a slug.
 *
 * @param {string} slug
 * @returns {string}
 */
export function iconSlugUrl(slug) {
  return `${ICON_CDN_BASE}/${slug}.svg`;
}

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
 * iconImageSrc — resolve an icon value to an <img> src, or null when it should
 * render as text (an emoji / bare glyph) or is empty.
 *
 * - full URL (http… or a leading "/") → routed through the local cache proxy
 * - a Dashboard Icons slug ("gitea") or a filename ("gitea.svg") → the CDN slug
 *   URL (lower-cased, image extension stripped, so "Gitea" and "gitea.svg" both
 *   resolve to the gitea icon)
 * - emoji / empty → null (the caller renders it as text)
 *
 * This is the single source of truth every renderer shares (renderIcon,
 * NodeCard, SettingsIcon, LinksTab) so a bare slug can never be printed as text.
 *
 * @param {string} value
 * @returns {string|null}
 */
// A bare value is treated as a Dashboard Icons slug only when it looks like one
// (2+ slug chars, optional image extension). Arbitrary text labels ("My Server",
// a "►" glyph) fall through to null so callers render them as text rather than a
// guaranteed-404 slug image.
const ICON_SLUG_RE = /^[a-z0-9][a-z0-9-]+(\.(svg|png|webp|jpe?g))?$/i;

export function iconImageSrc(value) {
  if (!value || typeof value !== 'string') return null;
  if (value.startsWith('http') || value.startsWith('/')) {
    return cachedIconUrl(value) || value;
  }
  if (isEmoji(value) || !ICON_SLUG_RE.test(value)) return null;
  const slug = value.toLowerCase().replace(/\.(svg|png|webp|jpe?g)$/, '');
  return cachedIconUrl(iconSlugUrl(slug)) || iconSlugUrl(slug);
}

/**
 * renderIcon — render an icon value (URL, slug, or emoji) as a React node.
 *
 * @param {string} icon
 * @returns {React.ReactNode}
 */
export function renderIcon(icon) {
  if (isEmoji(icon)) {
    return <span style={{ fontSize: 20, lineHeight: 1 }}>{icon}</span>;
  }
  const src = iconImageSrc(icon);
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      className="icon-img"
      onError={(e) => {
        e.target.style.display = 'none';
      }}
    />
  );
}
