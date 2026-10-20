/*
 * Switch (spec §5.4, #285): an on/off setting that applies at once, as the
 * mock's toggles (.tog): a 36 x 20 track, surface-3 off and the accent on, a
 * 16px on-accent thumb that slides 16px. Base UI's Switch: role="switch",
 * Space toggles it, and a hidden checkbox carries it in a form. Name it with
 * an enclosing <label>, a Field, or aria-label. The mock's locked toggle is a
 * disabled one. Its size is the same in both densities.
 */
import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import { cn } from './lib/utils.js';

function Switch({ className, ...props }) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-surface-3 p-0.5 transition-colors data-checked:bg-accent data-disabled:cursor-not-allowed data-disabled:opacity-55',
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="size-4 rounded-full bg-on-accent shadow-control transition-transform data-checked:translate-x-4" />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
