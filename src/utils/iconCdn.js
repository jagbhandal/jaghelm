// Dependency-free Dashboard Icons CDN helpers. This is a leaf module (imports
// nothing) so both src/utils/icon.jsx and src/hooks/useData.js can build slug
// URLs without importing each other — icon.jsx imports cachedIconUrl from
// useData, so if useData also imported icon.jsx the two would form a cycle.
// Keeping the CDN base + slug-URL builder here is the single source of truth.

// The repo moved from walkxcode to homarr-labs; pin every slug URL to the
// maintained base so all call sites resolve the same way.
export const ICON_CDN_BASE =
  'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg';

/** Build the Dashboard Icons SVG URL for a slug. */
export function iconSlugUrl(slug) {
  return `${ICON_CDN_BASE}/${slug}.svg`;
}
