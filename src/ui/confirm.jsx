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
 * which is never rendered. The subject is a quoted block (surface-2, no edge,
 * an 8px radius), so it never reads as a field to type in. Under it,
 * `description` says what will happen. `title`, the question, names the
 * dialog, and is required as the Dialog's is.
 *
 * `destructive` follows the controls' rule that danger is quiet (#285): the
 * confirm button is the `danger` button, red text and a red edge, never a red
 * fill, which is a status (design-system rule 3). It still leads: the main
 * action comes first, as in the mock, and Cancel is a ghost button, the
 * quietest. Focus starts on Cancel, so Enter alone never destroys anything.
 * Without `destructive` the confirm button is `primary` and focus starts on it.
 *
 * Opened from a Drawer or a Dialog, it stacks above it on a lighter scrim of
 * its own, and the overlay under it can't be clicked until it closes, so only
 * its buttons or Escape answer it (dialog.jsx).
 *
 * Base UI's part loads with the floating layer, as the Dialog's does
 * (dialog.jsx; floating/confirm.jsx).
 */
import { useId } from 'react';
import { requireName } from './lib/name.js';
import { useFloatingTrigger } from './lib/floating.jsx';
import { lightDialogTrigger } from './dialog.jsx';

const NO_NAME = 'Confirm needs a `name`: the display name of what it acts on, never a storage key';

function Confirm({ trigger, title, name, open, defaultOpen, ...props }) {
  if (typeof name !== 'string' || !name.trim()) {
    if (import.meta.env.DEV) throw new Error(NO_NAME);
    console.error(NO_NAME);
  }
  requireName('Confirm', { title, open });
  const ownId = useId();
  const triggerId = trigger?.props?.id ?? ownId;
  const { layer, handoff, light } = useFloatingTrigger({ now: Boolean(open || defaultOpen) });
  if (layer) {
    return (
      <layer.ConfirmLayer
        trigger={trigger}
        triggerId={triggerId}
        title={title}
        name={name}
        open={open}
        defaultOpen={defaultOpen}
        handoff={handoff}
        {...props}
      />
    );
  }
  return trigger ? light(trigger, lightDialogTrigger(triggerId)) : null;
}

export { Confirm };
