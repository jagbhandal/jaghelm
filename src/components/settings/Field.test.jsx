import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import Field from './Field';

// Field wraps a label + control, auto-associating them via useId/htmlFor and —
// when given an `error` — marking the control aria-invalid and wiring
// aria-describedby to a role="alert" error element. These tests lock in both
// the a11y wiring and the "no error → no noise" contract.

describe('Field a11y wiring', () => {
  it('auto-associates the label with a bare control via htmlFor/id', () => {
    render(
      <Field label="Latitude">
        <input placeholder="39.88" />
      </Field>
    );
    // getByLabelText resolves only if label htmlFor === control id.
    const input = screen.getByLabelText('Latitude');
    expect(input).toHaveAttribute('id');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-describedby');
  });

  it('renders no error element and no aria when error is absent/falsy', () => {
    const { rerender } = render(
      <Field label="Longitude">
        <input />
      </Field>
    );
    expect(screen.queryByRole('alert')).toBeNull();

    // Falsy values (null/''/false) must all behave as "no error".
    for (const e of [null, '', false]) {
      rerender(
        <Field label="Longitude" error={e}>
          <input />
        </Field>
      );
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.getByLabelText('Longitude')).not.toHaveAttribute('aria-invalid');
    }
  });

  it('marks the control invalid and links it to the alert when error is set', () => {
    render(
      <Field label="Latitude" error="Latitude must be between -90 and 90.">
        <input />
      </Field>
    );
    const input = screen.getByLabelText('Latitude');
    const alert = screen.getByRole('alert');

    expect(input).toHaveAttribute('aria-invalid', 'true');
    // aria-describedby must point at the alert element's id.
    expect(input.getAttribute('aria-describedby')).toBe(alert.getAttribute('id'));
    expect(alert).toHaveTextContent('Latitude must be between -90 and 90.');
    // Styled with the theme red token.
    expect(alert).toHaveStyle({ color: 'var(--red)' });
  });

  it('preserves a caller-provided aria-describedby alongside the error id', () => {
    render(
      <Field label="Latitude" error="bad">
        <input aria-describedby="hint-1" />
      </Field>
    );
    const input = screen.getByLabelText('Latitude');
    const describedBy = input.getAttribute('aria-describedby').split(' ');
    expect(describedBy).toContain('hint-1');
    expect(describedBy.length).toBe(2);
  });

  it('does not inject an id when the control already has one', () => {
    render(
      <Field label="Latitude">
        <input id="my-input" />
      </Field>
    );
    expect(screen.getByLabelText('Latitude')).toHaveAttribute('id', 'my-input');
  });

  it('leaves composite (non-labelable) children untouched and unlabelled', () => {
    render(
      <Field label="Temperature Unit" error="ignored-for-non-control">
        <div className="settings-choice-group">
          <button>°F</button>
        </div>
      </Field>
    );
    // No labelable control → htmlFor is undefined, so no element is "labelled".
    expect(screen.queryByLabelText('Temperature Unit')).toBeNull();
    // The button group child is rendered as-is (no aria-invalid injected).
    expect(screen.getByRole('button', { name: '°F' })).not.toHaveAttribute('aria-invalid');
  });
});
