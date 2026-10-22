/*
 * The Confirm's Base UI part, in the floating layer (lib/floating.jsx). The
 * component, its look and its behaviour are documented in ../confirm.jsx,
 * which draws the trigger until this loads.
 */
import { useRef, useState } from 'react';
import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog';
import { Button } from '../button.jsx';
import { ModalLayer } from './dialog.jsx';
import { useOverlayPortal } from '../lib/portal.js';
import { useHandoff } from './handoff.js';

function ConfirmLayer({
  trigger,
  triggerId,
  title,
  name,
  detail,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  value,
  onConfirm,
  onCancel,
  open,
  defaultOpen,
  onOpenChange,
  onOpenChangeComplete,
  handoff,
}) {
  const triggerRef = useRef(null);
  const [handle] = useState(AlertDialogPrimitive.createHandle);
  const cancelRef = useRef(null);
  // Set by the confirm button once onConfirm has returned, before Base UI
  // closes the dialog; any other way out (Cancel, Escape) is a cancel. An
  // onConfirm that throws leaves it unset: the dialog stays open, and a
  // Cancel after that still cancels.
  const confirmed = useRef(false);
  const [portalRoot, openChange] = useOverlayPortal(triggerRef, open, (next, details) => {
    if (!next) {
      if (!confirmed.current) onCancel?.();
      confirmed.current = false;
    }
    onOpenChange?.(next, details);
  });
  useHandoff(handoff, triggerRef, () => handle.open(triggerId));
  return (
    <AlertDialogPrimitive.Root
      handle={handle}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={openChange}
      onOpenChangeComplete={onOpenChangeComplete}
    >
      {trigger ? (
        <AlertDialogPrimitive.Trigger ref={triggerRef} id={triggerId} render={trigger} />
      ) : null}
      <ModalLayer
        portalRoot={portalRoot}
        placement="center"
        size="sm"
        data-slot="confirm"
        initialFocus={destructive ? cancelRef : true}
      >
        <AlertDialogPrimitive.Title className="text-title text-text-1">
          {title}
        </AlertDialogPrimitive.Title>
        <AlertDialogPrimitive.Description
          render={<div />}
          className="flex flex-col gap-3 text-text-2"
        >
          <div
            data-slot="confirm-subject"
            className="flex min-w-0 flex-col rounded-lg bg-surface-2 px-3 py-2.5"
          >
            <p className="font-semibold break-words text-text-1">{name}</p>
            {detail != null ? <p className="text-caption text-text-3">{detail}</p> : null}
          </div>
          {description != null ? <p>{description}</p> : null}
        </AlertDialogPrimitive.Description>
        <div data-slot="dialog-footer" className="flex flex-wrap items-center gap-2 pt-1">
          <AlertDialogPrimitive.Close
            render={<Button variant={destructive ? 'danger' : 'primary'} />}
            onClick={() => {
              onConfirm?.(value);
              confirmed.current = true;
            }}
          >
            {confirmLabel}
          </AlertDialogPrimitive.Close>
          <AlertDialogPrimitive.Close
            ref={cancelRef}
            data-slot="confirm-cancel"
            render={<Button variant="ghost" />}
          >
            {cancelLabel}
          </AlertDialogPrimitive.Close>
        </div>
      </ModalLayer>
    </AlertDialogPrimitive.Root>
  );
}

export { ConfirmLayer };
