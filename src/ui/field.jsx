/*
 * Field (spec §5.4, #285): a control with its label, help text and error, laid
 * out as the mock's settings fields: the label (13px semibold) over the
 * control, the help text under it (12px, text-3), 6px apart. Base UI's Field
 * wires them: the label names the control, the help text and the error are in
 * its aria-describedby, and an error sets aria-invalid. The error is crit's
 * word colour with an icon, so it never rests on colour alone; say what is
 * wrong and how to fix it.
 *
 * Works with Input, Select, Switch and Checkbox (any Base UI control). A Select
 * is labelled by a <div> rather than a <label>, which would open its list when
 * clicked; `nativeLabel` overrides the choice for a control wrapped in another
 * component.
 */
import { Children, isValidElement } from 'react';
import { Field as FieldPrimitive } from '@base-ui/react/field';
import { CircleAlert } from 'lucide-react';
import { cn } from './lib/utils.js';

function Field({ label, description, error, invalid, nativeLabel, className, children, ...props }) {
  const native =
    nativeLabel ??
    !Children.toArray(children).some(
      (child) => isValidElement(child) && child.type?.labelsWithoutLabelElement
    );
  return (
    <FieldPrimitive.Root
      data-slot="field"
      invalid={invalid ?? (error ? true : undefined)}
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
      {children}
      {description != null && (
        <FieldPrimitive.Description className="text-caption text-text-3">
          {description}
        </FieldPrimitive.Description>
      )}
      {error ? (
        <FieldPrimitive.Error match className="flex items-start gap-1.5 text-caption text-crit-fg">
          <CircleAlert className="mt-px size-3.5 shrink-0" strokeWidth={2} />
          {error}
        </FieldPrimitive.Error>
      ) : null}
    </FieldPrimitive.Root>
  );
}

export { Field };
