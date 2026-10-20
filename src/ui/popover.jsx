/*
 * Popover (spec §5.4, #286): a small panel tied to the control that opened it,
 * for content that belongs to that control (a filter, a short explanation,
 * a few actions). It is drawn as the mock's one floating card (the "shows
 * here" note over an app): surface-2 inside a strong edge, a 12px radius,
 * shadow-pop, 14px by 18px of padding, an optional bold title over 13px
 * text-2. It opens 6px from its trigger, below it by default, never wider than
 * 460px or the screen less 16px a side.
 *
 * Base UI's Popover does the behaviour: it is a non-modal dialog named by its
 * title; focus moves into it, Escape or a click outside closes it, and focus
 * returns to the trigger. `openOnHover` also opens it under the pointer (an
 * infotip: Base UI's advice for help behind an icon, which a tooltip would
 * hide from touch and screen reader users). It fades over 150ms (§5.3), or
 * appears at once with reduced motion asked for, and is portalled as a
 * `.jh-ui` root with the switches of the screen around its trigger.
 */
import { useRef } from 'react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { cn } from './lib/utils.js';
import { useOverlayPortal } from './lib/portal.js';

function Popover({
  trigger,
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
  children,
  ...props
}) {
  const triggerRef = useRef(null);
  const [portalRoot, openChange] = useOverlayPortal(triggerRef, open, onOpenChange);
  return (
    <PopoverPrimitive.Root open={open} defaultOpen={defaultOpen} onOpenChange={openChange}>
      <PopoverPrimitive.Trigger ref={triggerRef} render={trigger} openOnHover={openOnHover} />
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
            initialFocus={initialFocus}
            finalFocus={finalFocus}
            className={cn(
              'flex w-max max-w-[min(460px,calc(100vw-2rem))] flex-col gap-1 rounded-xl border border-border-strong bg-surface-2 px-4.5 py-3.5 text-body text-text-1 shadow-pop transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0',
              className
            )}
            {...props}
          >
            {title != null ? (
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

/** Closes the popover it sits in: `<PopoverClose render={<Button size="sm">Done</Button>} />`. */
const PopoverClose = PopoverPrimitive.Close;

export { Popover, PopoverClose };
