/*
 * The Tooltip's Base UI part, in the floating layer (lib/floating.js). The
 * component, its look and its behaviour are documented in ../tooltip.jsx,
 * which draws the trigger until this loads, and the description always.
 */
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import { cn } from '../lib/utils.js';
import { usePortalRoot } from '../lib/portal.js';
import { useHandoff } from './handoff.js';

function TooltipLayer({
  content,
  side,
  align,
  sideOffset,
  delay,
  closeDelay,
  className,
  describedBy,
  triggerRef,
  handoff,
  children,
}) {
  const [portalRoot, syncPortalRoot] = usePortalRoot(triggerRef);
  // Focus taken back on the hand-over opens it, as focus does.
  useHandoff(handoff, triggerRef);
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
            aria-hidden="true"
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

export { TooltipLayer };
