/*
 * Field (spec §5.4, #285): a control with its label, help text and error, laid
 * out as the mock's settings fields: the label (13px semibold) over the
 * control, the help text under it (12px, text-3), 6px apart. Base UI's Field
 * wires them: the label names the control, the help text and the error are in
 * its aria-describedby, and an error sets aria-invalid. The error is crit's
 * word colour with an icon, so it never rests on colour alone; say what is
 * wrong and how to fix it. `error` makes the field invalid; `invalid={false}`
 * says it isn't, and then the error is not shown either.
 *
 * Works with Input, Select, Switch, Checkbox and SegmentedControl (any Base UI
 * control). A Select or a SegmentedControl, however deeply it is wrapped, is
 * labelled by a <div> rather than a <label>: a <label> would open a Select's
 * list when clicked, and has no one control to point at in a group
 * (lib/field-context.js). `nativeLabel` sets the choice by hand.
 */
import { useMemo, useState } from 'react';
import { Field as FieldPrimitive } from '@base-ui/react/field';
import { CircleAlert } from 'lucide-react';
import { cn } from './lib/utils.js';
import { FieldContext } from './lib/field-context.js';

function Field({ label, description, error, invalid, nativeLabel, className, children, ...props }) {
  // How many controls inside asked not to be labelled by a <label>.
  const [noLabelElement, setNoLabelElement] = useState(0);
  const context = useMemo(
    () => ({ reportNoLabelElement: (n) => setNoLabelElement((count) => count + n) }),
    []
  );
  const native = nativeLabel ?? noLabelElement === 0;
  const showError = Boolean(error) && invalid !== false;
  return (
    <FieldPrimitive.Root
      data-slot="field"
      invalid={invalid ?? (showError ? true : undefined)}
      className={cn('flex min-w-0 flex-col gap-1.5', className)}
      {...props}
    >
      {label != null && (
        <FieldPrimitive.Label
          nativeLabel={native}
          render={native ? undefined : <div />}
          className="w-fit text-body-sm font-semibold text-text-1 data-disabled:opacity-55"
        >
          {label}
        </FieldPrimitive.Label>
      )}
      <FieldContext.Provider value={context}>{children}</FieldContext.Provider>
      {description != null && (
        <FieldPrimitive.Description className="text-caption text-text-3">
          {description}
        </FieldPrimitive.Description>
      )}
      {showError ? (
        <FieldPrimitive.Error match className="flex items-start gap-1.5 text-caption text-crit-fg">
          <CircleAlert className="mt-px size-3.5 shrink-0" strokeWidth={2} />
          {error}
        </FieldPrimitive.Error>
      ) : null}
    </FieldPrimitive.Root>
  );
}

export { Field };
