/*
 * Input (spec §5.4, #285): the mock's text field (.field): the page colour
 * inside a strong edge, 13px text, 34px tall (30 in compact), its focus ring
 * 1px out as the mock draws it. Base UI's Input, so inside a Field it takes the
 * field's label, help text and error (aria-describedby, aria-invalid) with no
 * wiring. An invalid field's edge turns crit-border; the Field says why.
 */
import { Input as InputPrimitive } from '@base-ui/react/input';
import { cn } from './lib/utils.js';

function Input({ className, ...props }) {
  return (
    <InputPrimitive
      data-slot="input"
      className={cn(
        'h-control w-full min-w-0 rounded-lg border border-border-strong bg-background px-2.5 text-body-sm text-text-1 transition-colors placeholder:text-text-3 focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:opacity-55 aria-invalid:border-crit-border',
        className
      )}
      {...props}
    />
  );
}

export { Input };
