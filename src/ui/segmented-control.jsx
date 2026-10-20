/*
 * SegmentedControl (spec §5.4, #285): one choice from two to four options, all
 * in view, as the mock's Density, Text size and Temperature pickers: segments
 * on a surface-3 track with 2px around them, the chosen one lifted onto
 * surface-1 (shadow-control), the others text-2. A segment is h-segment tall:
 * 28px, or 24 in compact.
 *
 * It is a radio group (Base UI's RadioGroup and Radio, each segment a native
 * button): Tab enters at the chosen segment, the arrow keys move and choose,
 * and one segment is always chosen. The mock marks its segments aria-pressed;
 * a radio group also says "one of", which pressed buttons don't. Name it with
 * aria-label or aria-labelledby. `options` is [{ value, label, icon?, disabled? }],
 * `icon` a Lucide component.
 */
import { RadioGroup } from '@base-ui/react/radio-group';
import { Radio } from '@base-ui/react/radio';
import { cn } from './lib/utils.js';

function SegmentedControl({ options, className, ...props }) {
  return (
    <RadioGroup
      data-slot="segmented-control"
      className={cn('inline-flex w-max gap-0.5 rounded-lg bg-surface-3 p-0.5', className)}
      {...props}
    >
      {options.map(({ value, label, icon: Icon, disabled }) => (
        <Radio.Root
          key={value}
          value={value}
          disabled={disabled}
          nativeButton
          render={<button type="button" />}
          className="inline-flex h-segment cursor-pointer items-center justify-center gap-1.5 rounded-md px-3.5 text-body-sm font-semibold whitespace-nowrap text-text-2 transition-colors not-data-checked:not-data-disabled:hover:text-text-1 data-checked:bg-surface-1 data-checked:text-text-1 data-checked:shadow-control data-disabled:cursor-not-allowed data-disabled:opacity-55"
        >
          {Icon ? <Icon className="size-3.5 shrink-0" strokeWidth={1.75} /> : null}
          {label}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}

export { SegmentedControl };
