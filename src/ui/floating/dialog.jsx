/*
 * The Dialog's Base UI part, in the floating layer (lib/floating.jsx), and the
 * modal layer the Drawer and the Confirm share with it. The component, its
 * look and its behaviour are documented in ../dialog.jsx, which draws the
 * trigger until this loads.
 */
import { createContext, useContext, useRef, useState } from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { cva } from 'class-variance-authority';
import { X } from 'lucide-react';
import { IconButton } from '../icon-button.jsx';
import { cn } from '../lib/utils.js';
import { hasText } from '../lib/name.js';
import { useOverlayPortal } from '../lib/portal.js';
import { useHandoff } from './handoff.js';

const popupVariants = cva(
  'fixed z-dialog flex flex-col overflow-y-auto overscroll-contain bg-surface-1 text-body text-text-1 shadow-pop',
  {
    variants: {
      placement: {
        // The command palette's place and frame; it fades.
        center:
          'top-24 left-1/2 max-h-[calc(100dvh-8rem)] max-w-[calc(100vw-2rem)] -translate-x-1/2 gap-3 rounded-xl border border-border-strong p-6 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0',
        // The mock's detail drawer: the full height on the right, 460px or the
        // whole screen if narrower, a subtle left edge; it slides in.
        right:
          'inset-y-0 right-0 w-[460px] max-w-full border-l border-border transition-transform data-ending-style:translate-x-full data-starting-style:translate-x-full',
      },
      size: {
        sm: 'w-[440px]',
        md: 'w-[540px]',
        lg: 'w-[600px]',
        none: '',
      },
    },
    defaultVariants: { placement: 'center', size: 'md' },
  }
);

/** True inside a modal layer: a layer opened from there is nested. */
const NestedLayerContext = createContext(false);

/**
 * The modal layer the Dialog, the Drawer and the Confirm share, inside their
 * Base UI Root: the portal (a `.jh-ui` root, `portalRoot`), the scrim and the
 * popup. Not for screens: use one of those three.
 *
 * Base UI draws no scrim for a nested dialog unless told to (`forceRender`).
 * The scrims sit on the popups' layer (`z-dialog`): a nested layer's portal
 * comes after its parent's popup, so its scrim covers that popup. The popup
 * under an open nested one is also `inert`.
 */
function ModalLayer({ portalRoot, placement, size, className, children, ...props }) {
  const nested = useContext(NestedLayerContext);
  return (
    <DialogPrimitive.Portal {...portalRoot}>
      <DialogPrimitive.Backdrop
        forceRender
        data-slot="scrim"
        data-nested={nested ? '' : undefined}
        className={cn(
          'fixed inset-0 z-dialog transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0',
          nested ? 'bg-scrim-nested' : 'bg-scrim'
        )}
      />
      <DialogPrimitive.Popup
        className={cn(popupVariants({ placement, size }), className)}
        render={(popupProps, state) => (
          <div {...popupProps} inert={state.nestedDialogOpen || undefined} />
        )}
        {...props}
      >
        <NestedLayerContext.Provider value>{children}</NestedLayerContext.Provider>
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

/** The ghost close button at the top right of a dialog or drawer. */
function CloseButton({ label, size, className }) {
  return (
    <DialogPrimitive.Close
      render={
        <IconButton label={label} size={size} className={cn('shrink-0', className)}>
          <X />
        </IconButton>
      }
    />
  );
}

function DialogLayer({
  trigger,
  triggerId,
  title,
  description,
  footer,
  size = 'md',
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
        placement="center"
        size={size}
        data-slot="dialog"
        initialFocus={initialFocus}
        finalFocus={finalFocus}
        className={className}
        {...props}
      >
        <div className="flex items-start gap-3">
          {/* Without a title, the aria-label names it: an empty Title would
              name it nothing (aria-labelledby beats aria-label). */}
          {hasText(title) ? (
            <DialogPrimitive.Title className="min-w-0 flex-1 text-title text-text-1">
              {title}
            </DialogPrimitive.Title>
          ) : (
            <div className="flex-1" />
          )}
          <CloseButton label={closeLabel} size="sm" className="-mt-0.5 -mr-2" />
        </div>
        {description != null ? (
          <DialogPrimitive.Description className="text-text-2">
            {description}
          </DialogPrimitive.Description>
        ) : null}
        {children}
        {footer != null ? (
          <div data-slot="dialog-footer" className="flex flex-wrap items-center gap-2 pt-1">
            {footer}
          </div>
        ) : null}
      </ModalLayer>
    </DialogPrimitive.Root>
  );
}

/** Closes the dialog or drawer it sits in (../dialog.jsx's DialogClose). */
const DialogClose = DialogPrimitive.Close;

export { DialogLayer, DialogClose, ModalLayer, CloseButton };
