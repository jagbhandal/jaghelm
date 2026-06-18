import React, { useId, isValidElement, cloneElement } from 'react';

/**
 * Field — shared label + control wrapper for the settings tabs.
 *
 * Generates a stable id with useId() and associates the <label> with its
 * control via htmlFor, so clicking the label focuses the input and assistive
 * tech announces the label (WCAG 1.3.1 / 3.3.2). One change here propagates to
 * every tab that delegates to this component.
 *
 * The id is auto-injected into the child ONLY when the child is a single bare
 * form control (input/select/textarea) without its own id. Composite children
 * (button groups, checkboxes that carry their own <label>, hint blocks) are
 * left untouched — the visible <label> still groups them, but we never attach
 * htmlFor to a non-labelable element.
 *
 * Variants:
 *   layout="field" (default) → <div.settings-field> + <label.settings-label>
 *   layout="row"             → <div.settings-stack-xs> + subtitle-styled label
 *                              (matches the old NodesTab/ServicesTab FieldRow)
 */
const LABELABLE = new Set(['input', 'select', 'textarea']);

export default function Field({ label, children, hint, layout = 'field' }) {
  const id = useId();

  let control = children;
  if (
    isValidElement(children) &&
    typeof children.type === 'string' &&
    LABELABLE.has(children.type) &&
    children.props.id == null
  ) {
    control = cloneElement(children, { id });
  }
  // Only point htmlFor at a control we actually labelled.
  const htmlFor = control !== children ? id : undefined;

  if (layout === 'row') {
    return (
      <div className="settings-stack-xs">
        <label className="settings-item-subtitle" style={{ letterSpacing: 0.5 }} htmlFor={htmlFor}>
          {label}
        </label>
        {control}
        {hint && (
          <span className="settings-item-subtitle" style={{ fontSize: 10, opacity: 0.7 }}>
            {hint}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="settings-field">
      <label className="settings-label" htmlFor={htmlFor}>{label}</label>
      {control}
      {hint && <span className="settings-hint">{hint}</span>}
    </div>
  );
}
