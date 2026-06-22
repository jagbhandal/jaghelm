import React from 'react';
import { iconImageSrc } from '../../utils/icon.jsx';

/**
 * Shared settings-tab primitives.
 *
 * Every settings tab had its own copy of these tiny building blocks — `Card`
 * was redefined verbatim in ~10 tabs, the toggle checkbox (`Chk`) in three, and
 * the `settings-choice-group` button row was hand-rolled inline in a dozen
 * places. Extracting them here means the markup, class names, and (newly added)
 * accessibility semantics live in exactly one spot, so a change propagates
 * everywhere instead of being patched tab-by-tab.
 *
 * These are presentational only — they take `value`/`onChange` and render the
 * existing `.settings-*` classes, so the visual output is unchanged.
 */

/**
 * Section card: an optional title heading over its children.
 * `title` may be any node (most callers pass a string).
 */
export function Card({ title, children }) {
  return (
    <div className="settings-card">
      {title && <h3 className="settings-card-title">{title}</h3>}
      {children}
    </div>
  );
}

/**
 * Checkbox toggle with an associated label. `onChange` receives the new boolean
 * checked state (not the event), matching every call site's existing usage.
 */
export function Toggle({ label, checked, onChange }) {
  return (
    <label className="settings-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

// Normalize an option to { value, label }. A bare primitive (string/number) is
// used as both the value and the label, so callers can pass ['F', 'C'] directly
// or [{ value, label }] when the two differ.
function toOption(opt) {
  return opt != null && typeof opt === 'object' ? opt : { value: opt, label: opt };
}

/**
 * Segmented single-choice button row (the `.settings-choice-group`). `value` is
 * the currently-selected option value; `onChange` receives the chosen value.
 * Options are compared with `===`, so pass the same type you store.
 *
 * Adds the accessibility the inline copies lacked: real `type="button"` buttons
 * (so a click can't submit a form) and `aria-pressed` reflecting the active
 * option. When an `ariaLabel` is given it also exposes a named `role="group"`;
 * without one it stays a plain div rather than shipping a nameless group.
 */
export function ChoiceGroup({ value, options, onChange, ariaLabel }) {
  return (
    <div
      className="settings-choice-group"
      role={ariaLabel ? 'group' : undefined}
      aria-label={ariaLabel}
    >
      {options.map((raw) => {
        const { value: v, label } = toOption(raw);
        const active = value === v;
        return (
          <button
            key={String(v)}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(v)}
            className={`settings-choice-btn ${active ? 'active' : ''}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Build a Dashboard Icons CDN URL for a preset icon key.
 *
 * Single source of truth for the icon CDN base. Uses the maintained
 * homarr-labs/dashboard-icons repo (the walkxcode/dashboard-icons base the
 * IntegrationsTab views used to inline is deprecated/read-only). Callers wrap
 * the result in cachedIconUrl() so it's proxied through the local icon cache.
 */
export function presetIconUrl(iconKey) {
  return `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/${iconKey}.svg`;
}

/**
 * SettingsIcon — renders an icon value (URL, Dashboard Icons slug/filename, or
 * emoji). A URL or slug resolves to an <img> via the shared iconImageSrc(); an
 * emoji/bare glyph renders as text. When `value` is empty the `fallback` glyph
 * is shown. `size` sets the <img> box (px). Broken image URLs hide themselves
 * via onError.
 */
export function SettingsIcon({ value, fallback = '', size = 24 }) {
  const resolved = value || fallback;
  const src = iconImageSrc(resolved);
  if (src) {
    return (
      <img
        src={src}
        alt=""
        style={{ width: size, height: size, borderRadius: 4, objectFit: 'contain' }}
        onError={(e) => {
          e.target.style.display = 'none';
        }}
      />
    );
  }
  return resolved;
}

/**
 * Empty-state placeholder: a dashed-bordered box with an optional emoji/icon and
 * a short message, for sections that have nothing to show yet.
 */
export function EmptyState({ icon, children }) {
  return (
    <div className="settings-empty-state">
      {icon && (
        <span className="settings-empty-state-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <p className="settings-empty-state-text">{children}</p>
    </div>
  );
}
