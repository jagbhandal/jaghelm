/*
 * The Popover's Base UI part, in the floating layer (lib/floating.jsx). The
 * component, its look and its behaviour are documented in ../popover.jsx,
 * which draws the trigger until this loads.
 */
import { useRef, useState } from 'react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { hasText } from '../lib/name.js';
import { cn } from '../lib/utils.js';
import { useOverlayPortal } from '../lib/portal.js';
import { useHandoff } from './handoff.js';

function PopoverLayer({
  trigger,
  triggerId,
  title,
  description,
  side = 'bottom',
  align = 'center',
  sideOffset = 6,
  openOnHover = false,
  open,
  defaultOpen,
  onOpenChange,
  initialFocus,
  finalFocus,
  className,
  handoff,
  children,
  ...props
}) {
  const triggerRef = useRef(null);
  const [handle] = useState(PopoverPrimitive.createHandle);
  const [portalRoot, openChange] = useOverlayPortal(triggerRef, open, onOpenChange);
  useHandoff(handoff, triggerRef, () => handle.open(triggerId));
  // Untitled and unlabelled: named by its trigger.
  const namedByTrigger =
    !hasText(title) && !hasText(props['aria-label']) && !props['aria-labelledby'];
  return (
    <PopoverPrimitive.Root
      handle={handle}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={openChange}
    >
      <PopoverPrimitive.Trigger
        ref={triggerRef}
        id={triggerId}
        render={trigger}
        openOnHover={openOnHover}
      />
      <PopoverPrimitive.Portal {...portalRoot}>
        <PopoverPrimitive.Positioner
          side={side}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={16}
          className="z-dialog"
        >
          <PopoverPrimitive.Popup
            data-slot="popover"
            {...(namedByTrigger ? { 'aria-labelledby': triggerId } : null)}
            initialFocus={initialFocus}
            finalFocus={finalFocus}
            className={cn(
              'flex w-max max-w-[min(460px,calc(100vw-2rem))] flex-col gap-1 rounded-xl border border-border-strong bg-surface-2 px-4.5 py-3.5 text-body text-text-1 shadow-pop transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0',
              className
            )}
            {...props}
          >
            {hasText(title) ? (
              <PopoverPrimitive.Title className="font-bold">{title}</PopoverPrimitive.Title>
            ) : null}
            {description != null ? (
              <PopoverPrimitive.Description className="text-body-sm text-text-2">
                {description}
              </PopoverPrimitive.Description>
            ) : null}
            {children}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

export { PopoverLayer };
export const PopoverClose = PopoverPrimitive.Close;
