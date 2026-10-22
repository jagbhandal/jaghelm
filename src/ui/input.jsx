/*
 * Input (spec §5.4, #285): the mock's text field (.field): the page colour
 * inside a strong edge, 13px text, 34px tall in both densities, its focus ring
 * 1px out as the mock draws it. Base UI's Input, so inside a Field it takes the
 * field's label, help text and error (aria-describedby, aria-invalid) with no
 * wiring. An invalid field's edge turns crit-border; the Field says why.
 *
 * A date field (`type="date"`, #301) is the same field: while it is empty
 * (`value` ''), its day, month and year show in text-3, as a placeholder
 * does, and the browser's calendar button is dimmed to the icons' weight,
 * full strength under the pointer, so it doesn't read as the browser's own
 * control in a JagHelm field.
 */
import { Input as InputPrimitive } from '@base-ui/react/input';
import { cn } from './lib/utils.js';

const DATE =
  'data-empty:text-text-3 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-55 hover:[&::-webkit-calendar-picker-indicator]:opacity-100';

function Input({ className, ...props }) {
  const date = props.type === 'date';
  return (
    <InputPrimitive
      data-slot="input"
      data-empty={date && props.value === '' ? '' : undefined}
      className={cn(
        'h-control w-full min-w-0 rounded-lg border border-border-strong bg-background px-2.5 text-body-sm text-text-1 transition-colors placeholder:text-text-3 focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:opacity-55 aria-invalid:border-crit-border',
        date && DATE,
        className
      )}
      {...props}
    />
  );
}

export { Input };
