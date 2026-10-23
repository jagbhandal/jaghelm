/*
 * The Sparkline's tooltip, Base UI's, in the floating layer
 * (lib/floating.jsx): the value and time of the point the pointer or the
 * keyboard is on, above the chart, over the point. ../sparkline.jsx draws the
 * chart, says when it opens, and documents both. The UptimeBar's check
 * (../uptime-bar.jsx, #312) uses it too, as its `slot` says.
 */
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';

function SparklineTip({
  open,
  onOpenChange,
  portalRoot,
  anchor,
  slot = 'sparkline-tooltip',
  children,
}) {
  return (
    <TooltipPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <TooltipPrimitive.Portal {...portalRoot}>
        <TooltipPrimitive.Positioner
          anchor={anchor}
          side="top"
          sideOffset={8}
          collisionPadding={8}
          className="pointer-events-none z-dialog"
        >
          <TooltipPrimitive.Popup
            data-slot={slot}
            aria-hidden="true"
            className="flex items-baseline gap-2 rounded-md border border-border-strong bg-surface-2 px-2 py-1 text-caption whitespace-nowrap text-text-1 shadow-pop"
          >
            {children}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export { SparklineTip };
