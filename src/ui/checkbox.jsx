/*
 * Checkbox (spec §5.4, #285): a 16px box, as the mock's checklist and "Open in
 * a new browser tab" boxes: the page colour inside a strong edge, filled with
 * the accent and ticked in on-accent when checked, a bar when mixed
 * (`indeterminate`). Base UI's Checkbox: role="checkbox", Space toggles it,
 * aria-checked is "mixed" when indeterminate, and a hidden checkbox carries it
 * in a form. Name it with an enclosing <label> (the mock's pattern), a Field,
 * or aria-label. Its size is the same in both densities.
 */
import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';
import { Check, Minus } from 'lucide-react';
import { cn } from './lib/utils.js';

function Checkbox({ className, ...props }) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'group/checkbox inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-border-strong bg-background text-on-accent transition-colors data-checked:border-accent data-checked:bg-accent data-indeterminate:border-accent data-indeterminate:bg-accent data-disabled:cursor-not-allowed data-disabled:opacity-55 aria-invalid:border-crit-border',
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex">
        <Check className="size-3.5 group-data-indeterminate/checkbox:hidden" strokeWidth={3} />
        <Minus
          className="hidden size-3.5 group-data-indeterminate/checkbox:block"
          strokeWidth={3}
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
