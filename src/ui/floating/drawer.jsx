/*
 * The Drawer's Base UI part, in the floating layer (lib/floating.jsx). The
 * component, its look and its behaviour are documented in ../drawer.jsx,
 * which draws the trigger until this loads.
 */
import { useRef, useState } from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { CloseButton, ModalLayer } from './dialog.jsx';
import { hasText } from '../lib/name.js';
import { useOverlayPortal } from '../lib/portal.js';
import { useHandoff } from './handoff.js';

function DrawerLayer({
  trigger,
  triggerId,
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
  handoff,
  children,
  ...props
}) {
  const triggerRef = useRef(null);
  const [handle] = useState(DialogPrimitive.createHandle);
  const [portalRoot, openChange] = useOverlayPortal(triggerRef, open, onOpenChange);
  useHandoff(handoff, triggerRef, () => handle.open(triggerId));
  return (
    <DialogPrimitive.Root
      handle={handle}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={openChange}
      onOpenChangeComplete={onOpenChangeComplete}
    >
      {trigger ? <DialogPrimitive.Trigger ref={triggerRef} id={triggerId} render={trigger} /> : null}
      <ModalLayer
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
      </ModalLayer>
    </DialogPrimitive.Root>
  );
}

export { DrawerLayer };
