/*
 * SegmentedControl (spec §5.4, #285): one choice from two to four options, all
 * in view, as the mock's Density, Text size and Temperature pickers: segments
 * on a surface-3 track with 2px around them, the chosen one lifted onto
 * surface-1 (shadow-control), the others text-2. A segment is h-segment tall,
 * 30px, so with its track's 2px padding the control is h-control (34px), as an
 * Input or Button beside it; the same in both densities.
 *
 * It is a radio group (Base UI's RadioGroup and Radio, each segment a native
 * button): Tab enters at the chosen segment, the arrow keys move and choose,
 * and one segment is always chosen. The mock marks its segments aria-pressed;
 * a radio group also says "one of", which pressed buttons don't. Name it with
 * aria-label or aria-labelledby, or put it in a Field, whose label names the
 * group as a fieldset's legend does (a <div>; lib/field-context.js). `options`
 * is [{ value, label, icon?, disabled? }], `icon` a Lucide component.
 *
 * `size="touch"` (#602), for a phone's sheet: each segment a 44px target
 * (at least 44px wide too), so the control is 48px tall; the look is the same.
 */
import { Field } from '@base-ui/react/field';
import { RadioGroup } from '@base-ui/react/radio-group';
import { Radio } from '@base-ui/react/radio';
import { cn } from './lib/utils.js';
import { useInsideField, useNoLabelElement } from './lib/field-context.js';

/** A segment's height by size: the control's (34px with its track), or a thumb's 44px. */
const SEGMENT = { md: 'h-segment', touch: 'h-11 min-w-11' };

function SegmentedControl({ options, size = 'md', className, ...props }) {
  useNoLabelElement();
  const insideField = useInsideField();
  return (
    <RadioGroup
      data-slot="segmented-control"
      data-size={size}
      className={cn('inline-flex w-max gap-0.5 rounded-lg bg-surface-3 p-0.5', className)}
      {...props}
    >
      {options.map(({ value, label, icon: Icon, disabled }) => {
        const segment = (
          <Radio.Root
            key={value}
            value={value}
            disabled={disabled}
            nativeButton
            render={<button type="button" />}
            className={cn(
              'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-3.5 text-body-sm font-semibold whitespace-nowrap text-text-2 transition-colors not-data-checked:not-data-disabled:hover:text-text-1 data-checked:bg-surface-1 data-checked:text-text-1 data-checked:shadow-control data-disabled:cursor-not-allowed data-disabled:opacity-55',
              SEGMENT[size] ?? SEGMENT.md
            )}
          >
            {Icon ? <Icon className="size-3.5 shrink-0" strokeWidth={1.75} /> : null}
            {label}
          </Radio.Root>
        );
        // Inside a Field, Base UI gives every radio the Field's label and its
        // one id; a Field.Item gives each segment its own, named by its text.
        return insideField ? (
          <Field.Item key={value} className="contents">
            {segment}
          </Field.Item>
        ) : (
          segment
        );
      })}
    </RadioGroup>
  );
}

export { SegmentedControl };
