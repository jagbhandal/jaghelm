/*
 * Tooltip (spec §5.4, #286): a short label for a control, shown under the
 * pointer or on keyboard focus: the mock's `title` notes ("Still loaded: opens
 * where you left it"), drawn rather than left to the browser. The mock draws
 * none, so it takes the popovers' surface at a smaller size: surface-2 inside
 * a strong edge, a 6px radius, 4px by 8px of padding, 12px text-1, shadow-pop.
 * It opens 6px above its trigger by default, after 600ms under the pointer
 * (Base UI's delay; once one is open, the next opens at once) or at once on
 * focus, and Escape closes it. It fades over 150ms, or appears at once with
 * reduced motion asked for.
 *
 * Base UI's tooltips are visual only, and never open on touch, so nothing may
 * live only in a tooltip (Base UI's guidance). The trigger keeps its own name
 * (an IconButton's `label`); when the tooltip says more than that name, the
 * trigger is also described by it (aria-describedby, pointing at a hidden copy
 * that is always in the page), so a screen reader hears it without opening it.
 *
 * `children` is the trigger, one element that takes a ref and its props.
 */
import { useId, useRef } from 'react';
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import { cn } from './lib/utils.js';
import { usePortalRoot } from './lib/portal.js';

function Tooltip({
  content,
  side = 'top',
  align = 'center',
  sideOffset = 6,
  delay,
  closeDelay,
  className,
  children,
}) {
  const triggerRef = useRef(null);
  const [portalRoot, syncPortalRoot] = usePortalRoot(triggerRef);
  const descriptionId = useId();
  const own = children?.props ?? {};
  // Said already by the trigger's name: describing it again would repeat it.
  const repeatsName =
    typeof content === 'string' && (own.label === content || own['aria-label'] === content);
  const describedBy = repeatsName
    ? own['aria-describedby']
    : [own['aria-describedby'], descriptionId].filter(Boolean).join(' ');
  return (
    <TooltipPrimitive.Root
      onOpenChange={(open) => {
        if (open) syncPortalRoot();
      }}
    >
      <TooltipPrimitive.Trigger
        ref={triggerRef}
        render={children}
        delay={delay}
        closeDelay={closeDelay}
        aria-describedby={describedBy}
      />
      {repeatsName ? null : (
        <span id={descriptionId} hidden>
          {content}
        </span>
      )}
      <TooltipPrimitive.Portal {...portalRoot}>
        <TooltipPrimitive.Positioner
          side={side}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={8}
          className="z-dialog"
        >
          <TooltipPrimitive.Popup
            data-slot="tooltip"
            className={cn(
              'max-w-[min(280px,calc(100vw-1rem))] rounded-md border border-border-strong bg-surface-2 px-2 py-1 text-caption text-text-1 shadow-pop transition-opacity data-ending-style:opacity-0 data-instant:transition-none data-starting-style:opacity-0',
              className
            )}
          >
            {content}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export { Tooltip };
