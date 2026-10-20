/*
 * Confirm (spec §5.4, #286): asks before an action that can't be taken back,
 * such as removing a device or an integration. Base UI's AlertDialog: an
 * alertdialog that only the two buttons or Escape (which cancels) close, never
 * a click on the scrim; focus stays inside and returns to whatever opened it.
 * It is drawn as the Dialog (dialog.jsx), 440px wide.
 *
 * It names the thing by its display name, never a storage key. `name` (what
 * the person calls it: "Pixel 8", "Immich") is required and shown as the
 * subject, with `detail` under it; a missing name throws in development and
 * logs in production, as an IconButton without a label does. The key the
 * screen needs to act on travels as `value`, which `onConfirm` gets back and
 * which is never rendered. Under the subject, `description` says what will
 * happen.
 *
 * `destructive` follows the controls' rule that danger is quiet (#285): the
 * confirm button is the `danger` button, red text and a red edge, never a red
 * fill, which is a status (design-system rule 3). It still leads: the main
 * action comes first, as in the mock, and Cancel is a ghost button, the
 * quietest. Focus starts on Cancel, so Enter alone never destroys anything.
 * Without `destructive` the confirm button is `primary` and focus starts on it.
 */
import { useRef } from 'react';
import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog';
import { Button } from './button.jsx';
import { DialogLayer } from './dialog.jsx';
import { useOverlayPortal } from './lib/portal.js';

const NO_NAME = 'Confirm needs a `name`: the display name of what it acts on, never a storage key';

function Confirm({
  trigger,
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
}) {
  if (typeof name !== 'string' || !name.trim()) {
    if (import.meta.env.DEV) throw new Error(NO_NAME);
    console.error(NO_NAME);
  }
  const triggerRef = useRef(null);
  const cancelRef = useRef(null);
  // Set by the confirm button, whose click runs before Base UI closes the
  // dialog; any other way out (Cancel, Escape) is a cancel.
  const confirmed = useRef(false);
  const [portalRoot, openChange] = useOverlayPortal(triggerRef, open, (next, details) => {
    if (!next) {
      if (!confirmed.current) onCancel?.();
      confirmed.current = false;
    }
    onOpenChange?.(next, details);
  });
  return (
    <AlertDialogPrimitive.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={openChange}
      onOpenChangeComplete={onOpenChangeComplete}
    >
      {trigger ? <AlertDialogPrimitive.Trigger ref={triggerRef} render={trigger} /> : null}
      <DialogLayer
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
            className="flex min-w-0 flex-col rounded-lg border border-border bg-background px-3 py-2.5"
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
              confirmed.current = true;
              onConfirm?.(value);
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
      </DialogLayer>
    </AlertDialogPrimitive.Root>
  );
}

export { Confirm };
