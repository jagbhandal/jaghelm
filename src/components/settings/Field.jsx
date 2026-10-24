import React, { Children, useId, isValidElement, cloneElement } from 'react';

/**
 * Field — shared label + control wrapper for the settings tabs.
 *
 * Generates a stable id with useId() and associates the <label> with its
 * control via htmlFor, so clicking the label focuses the input and assistive
 * tech announces the label (WCAG 1.3.1 / 3.3.2). One change here propagates to
 * every tab that delegates to this component.
 *
 * The id is auto-injected into the control ONLY when the child is a single bare
 * form control (input/select/textarea) without its own id, or the only bare
 * form control among several children (a slider over its range labels, #317).
 * Composite children (button groups, checkboxes that carry their own <label>,
 * hint blocks) are left untouched — the visible <label> still groups them,
 * but we never attach htmlFor to a non-labelable element.
 *
 * Optional `error` prop: when truthy, the wrapped control is marked
 * aria-invalid="true" and aria-describedby is pointed at a role="alert" error
 * element rendered below the control (styled with var(--red), WCAG 3.3.1). When
 * absent/falsy, neither attribute is added and no error element is rendered.
 * Error wiring is applied to any labelable bare control — even one that already
 * carries its own id — so validation works regardless of auto-id injection.
 *
 * Variants:
 *   layout="field" (default) → <div.settings-field> + <label.settings-label>
 *   layout="row"             → <div.settings-stack-xs> + subtitle-styled label
 *                              (matches the old NodesTab/ServicesTab FieldRow)
 */
const LABELABLE = new Set(['input', 'select', 'textarea']);

export default function Field({ label, children, hint, error, layout = 'field' }) {
  const id = useId();
  const errorId = `${id}-error`;
  const hasError = error != null && error !== false && error !== '';

  // The field's control: the child when it is a single bare form control, or
  // the one bare form control among several children (a slider over its
  // range labels, #317), which we can safely augment with a11y attributes
  // (id / aria-invalid / aria-describedby). None, or more than one: none.
  const isBare = (el) =>
    isValidElement(el) && typeof el.type === 'string' && LABELABLE.has(el.type);
  const kids = Children.toArray(children);
  const bare = kids.filter(isBare);
  const target = bare.length === 1 ? bare[0] : null;

  let control = children;
  if (target) {
    const extra = {};
    // Auto-inject id only when the control doesn't already have one.
    if (target.props.id == null) extra.id = id;
    // Error wiring works whether or not we injected the id above.
    if (hasError) {
      extra['aria-invalid'] = 'true';
      // Preserve any caller-provided aria-describedby alongside the error id.
      extra['aria-describedby'] = [target.props['aria-describedby'], errorId]
        .filter(Boolean)
        .join(' ');
    }
    if (Object.keys(extra).length > 0) {
      const augmented = cloneElement(target, extra);
      control = kids.length === 1 ? augmented : kids.map((k) => (k === target ? augmented : k));
    }
  }
  // Only point htmlFor at a control that carries a usable id.
  const htmlFor = target ? target.props.id ?? id : undefined;

  const errorEl = hasError ? (
    <span
      id={errorId}
      role="alert"
      style={{ color: 'var(--red)', fontSize: 12, marginTop: 2 }}
    >
      {error}
    </span>
  ) : null;

  if (layout === 'row') {
    return (
      <div className="settings-stack-xs">
        <label className="settings-item-subtitle" style={{ letterSpacing: 0.5 }} htmlFor={htmlFor}>
          {label}
        </label>
        {control}
        {errorEl}
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
      {errorEl}
      {hint && <span className="settings-hint">{hint}</span>}
    </div>
  );
}

/**
 * FieldRow — the row-layout convenience wrapper that NodesTab, ServicesTab and
 * the Integrations config form (before #323) each used to redefine locally (byte-identical
 * copies / a FieldGroup alias). Delegates to <Field layout="row">, so the
 * label/htmlFor/error wiring stays in one place.
 */
export function FieldRow({ label, hint, error, children }) {
  return (
    <Field layout="row" label={label} hint={hint} error={error}>
      {children}
    </Field>
  );
}
