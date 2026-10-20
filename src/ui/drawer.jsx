/*
 * Drawer (spec §5.4, #286): the details of one thing (a service, a node, an
 * issue) beside the screen, as the mock's detail drawer: the full height on
 * the right, 460px wide or the whole screen if narrower, surface-1 with a
 * subtle left edge and shadow-pop, over the scrim. Its header is the mock's:
 * an overline (`eyebrow`, the kind of thing), the title (20/26 bold), a 13px
 * line under it in text-3 (`description`, where it is), a ghost close button,
 * and a subtle rule. The overline and that line sit in 20px lines, as the
 * mock's do, so the header is the mock's 110px. The body has 20px of padding,
 * 20px between sections, in both densities, as the mock's.
 *
 * It is a modal Dialog placed at the edge (Base UI's advice for a drawer
 * without gestures; the mock has none), so it behaves as one: focus moves in
 * and stays (Tab and Shift+Tab cycle inside), Escape or a click on the scrim
 * closes it, and focus returns to the row that opened it. It slides in from
 * the right over 150ms (§5.3), or appears at once with reduced motion asked
 * for.
 *
 * `trigger` opens it; without one, control it with `open` and `onOpenChange`
 * (a list of rows sharing one drawer). `title` names it, as the Dialog's does
 * (an `aria-label` without one). A DialogClose closes it from inside; a
 * Confirm opened from it stacks above it, on a lighter scrim of its own.
 */
import { useRef } from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { CloseButton, DialogLayer } from './dialog.jsx';
import { hasText, requireName } from './lib/name.js';
import { useOverlayPortal } from './lib/portal.js';

function Drawer({
  trigger,
  eyebrow,
  title,
  description,
  closeLabel = 'Close',
  open,
  defaultOpen,
  onOpenChange,
  onOpenChangeComplete,
  initialFocus,
  finalFocus,
  className,
  children,
  ...props
}) {
  requireName('Drawer', { title, open, props });
  const triggerRef = useRef(null);
  const [portalRoot, openChange] = useOverlayPortal(triggerRef, open, onOpenChange);
  return (
    <DialogPrimitive.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={openChange}
      onOpenChangeComplete={onOpenChangeComplete}
    >
      {trigger ? <DialogPrimitive.Trigger ref={triggerRef} render={trigger} /> : null}
      <DialogLayer
        portalRoot={portalRoot}
        placement="right"
        size="none"
        data-slot="drawer"
        initialFocus={initialFocus}
        finalFocus={finalFocus}
        className={className}
        {...props}
      >
        <div className="flex items-start gap-3 border-b border-border px-5 pt-5 pb-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {eyebrow != null ? (
              <span className="text-overline leading-5 text-text-3 uppercase">{eyebrow}</span>
            ) : null}
            {hasText(title) ? (
              <DialogPrimitive.Title className="text-title text-text-1">
                {title}
              </DialogPrimitive.Title>
            ) : null}
            {description != null ? (
              <DialogPrimitive.Description className="text-body-sm leading-5 text-text-3">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <CloseButton label={closeLabel} size="md" />
        </div>
        <div data-slot="drawer-body" className="flex flex-col gap-5 p-5">
          {children}
        </div>
      </DialogLayer>
    </DialogPrimitive.Root>
  );
}

export { Drawer };
export { DialogClose as DrawerClose } from './dialog.jsx';
