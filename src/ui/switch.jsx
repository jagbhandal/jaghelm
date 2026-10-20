/*
 * Switch (spec §5.4, #285): an on/off setting that applies at once, as the
 * mock's toggles (.tog): a 36 x 20 track, surface-3 off and the accent on, a
 * 16px white thumb (switch-thumb) that slides 16px, lifted by shadow-thumb, the
 * mock's shadow in both themes. Off, the track also has a 1px control-edge
 * edge, which the mock lacks: surface-3 alone is too faint against the page
 * (1.2:1 in light), and the edge carries the 3:1 a control's boundary needs
 * (WCAG 1.4.11). On, the edge is the accent, so the track looks as the mock's.
 * Base UI's Switch: role="switch", Space toggles it, and a hidden checkbox
 * carries it in a form. Name it with an enclosing <label>, a Field, or
 * aria-label. The mock's locked toggle is a disabled one. Its size is the same
 * in both densities.
 */
import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import { cn } from './lib/utils.js';

function Switch({ className, ...props }) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-control-edge bg-surface-3 p-px transition-colors data-checked:border-accent data-checked:bg-accent data-disabled:cursor-not-allowed data-disabled:opacity-55',
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="size-4 rounded-full bg-switch-thumb shadow-thumb transition-transform data-checked:translate-x-4" />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
