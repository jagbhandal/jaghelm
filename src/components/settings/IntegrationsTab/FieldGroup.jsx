import React from 'react';
import Field from '../Field';

/**
 * FieldGroup — small label + optional hint wrapper used by ConfigView form rows.
 * Delegates to the shared Field (row layout) so a single useId/htmlFor change
 * propagates here too — the control gets associated with its label for AT.
 */
export default function FieldGroup({ label, hint, children }) {
  return (
    <Field layout="row" label={label} hint={hint}>
      {children}
    </Field>
  );
}
