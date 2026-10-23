import React, { createContext, useContext, useId } from 'react';
import { ShellSection } from '@ui/app-shell';
import { Button } from '@ui/button';
import { iconImageSrc } from '../../utils/icon.jsx';

/**
 * Shared settings-tab primitives: one home for the tiny building blocks each tab
 * used to copy inline, so markup, class names, and a11y semantics change in one place.
 * Presentational only — `value`/`onChange` over the existing `.settings-*` classes.
 */

// The level of the next heading down (#317): a section's page is the h1, its
// cards and groups h2, a card inside a group h3.
const HeadingLevel = createContext(2);

/**
 * Section card: an optional title heading over its children.
 * `title` may be any node (most callers pass a string). The heading is the
 * level under the one around it: an h2 on a section's page, an h3 in a Group.
 */
export function Card({ title, children }) {
  const Heading = `h${useContext(HeadingLevel)}`;
  return (
    <div className="settings-card">
      {title && <Heading className="settings-card-title">{title}</Heading>}
      {children}
    </div>
  );
}

/**
 * A titled part of a section's page (#317) that brings its own cards, such
 * as a tab Settings had before (Nodes, Quick Launch links): its title as a
 * heading at a card's level (`description` under it), and its children a
 * level down, so the cards inside it are its subheadings. Named by its title.
 */
export function Group({ title, description, children }) {
  const id = useId();
  const level = useContext(HeadingLevel);
  const Heading = `h${level}`;
  return (
    <section aria-labelledby={id} className="settings-section">
      <div>
        <Heading id={id} className="settings-group-title">
          {title}
        </Heading>
        {description && (
          <p className="settings-hint-block" style={{ marginTop: 2 }}>
            {description}
          </p>
        )}
      </div>
      <HeadingLevel.Provider value={level + 1}>{children}</HeadingLevel.Provider>
    </section>
  );
}

/**
 * The design system's Button (`@ui/button`, its props) in today's Settings
 * markup (#276, #317): in a root of its own (the shell's theme), which draws
 * no box (`display: contents`), so the button sits in the row as the old one
 * did and the legacy markup around it is left alone.
 */
export function UiButton(props) {
  return (
    <ShellSection style={{ display: 'contents' }}>
      <Button {...props} />
    </ShellSection>
  );
}

/**
 * Checkbox toggle with an associated label. `onChange` receives the new boolean
 * checked state (not the event), matching every call site's existing usage.
 * `description`, a line under the label, is the box's description (not part
 * of its name); `disabled` locks it as it is (#307: the Overview's attention
 * panel, which can't be hidden).
 */
export function Toggle({ label, checked, onChange, description, disabled = false }) {
  const id = useId();
  return (
    <label className="settings-toggle" style={disabled ? { cursor: 'default' } : undefined}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-labelledby={description ? `${id}-label` : undefined}
        aria-describedby={description ? `${id}-desc` : undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
      {description ? (
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span id={`${id}-label`}>{label}</span>
          <span id={`${id}-desc`} className="settings-hint-block" style={{ marginTop: 2 }}>
            {description}
          </span>
        </span>
      ) : (
        <span>{label}</span>
      )}
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
