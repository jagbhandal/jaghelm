/*
 * Dialog (spec §5.4, #286): a modal over the screen, for a short task or a
 * message that needs an answer before the person goes on. It is drawn as the
 * mock's command palette, its one modal: surface-1 inside a strong edge, a
 * 12px radius, shadow-pop over the scrim, 96px from the top and centred,
 * never wider than the screen less 16px a side. Its content is laid out as the
 * mock's "won't open inside JagHelm" card: 24px of padding, the title (20/26
 * bold), the description in text-2 and the content, 12px apart, and the
 * actions in a row under them, the main one first (the mock's order). A ghost
 * close button sits top right, beside the title, as the drawer's does.
 *
 * Base UI's Dialog does the behaviour: focus moves into the dialog and stays
 * there (Tab and Shift+Tab cycle inside it), Escape or a click on the scrim
 * closes it, focus goes back to whatever opened it, the page under it is inert
 * and stops scrolling, and the title and description name and describe it.
 *
 * One opened from inside another (a Confirm from a Drawer) gets a scrim of its
 * own, on the popups' layer, so it stacks above the one under it, which can't
 * be clicked or reached by Tab until it closes. That scrim is half as strong
 * (`bg-scrim-nested`): the overlay under it reads as dimmed, and the page under
 * both never goes near black. Escape closes only the top one.
 *
 * It fades in and out over 150ms (§5.3), the scrim with it; with reduced motion
 * asked for, the base style cuts that to nothing (tailwind.css). It is
 * portalled as a `.jh-ui` root carrying the screen's switches, taken from the
 * UiRoot, or from its trigger outside one (lib/portal.js).
 *
 * `trigger` is the element that opens it (a Button); without one, control it
 * with `open` and `onOpenChange`. `title` names it; without one, give it an
 * `aria-label`, or it throws in development and logs in production. `footer`
 * holds the actions; a DialogClose closes it from one of them. The Drawer and
 * the Confirm reuse its layer.
 *
 * Base UI's part loads with the floating layer, on first use
 * (lib/floating.jsx; floating/dialog.jsx): at once when it is opened from
 * code, and until then a trigger is drawn here as a closed dialog's
 * (aria-haspopup, aria-expanded), and a click on it opens the dialog as soon
 * as the layer is in.
 */
import { useId } from 'react';
import { requireName } from './lib/name.js';
import { useFloatingLayer, useFloatingTrigger } from './lib/floating.jsx';

function Dialog({ trigger, title, open, defaultOpen, ...props }) {
  requireName('Dialog', { title, open, props });
  const ownId = useId();
  const triggerId = trigger?.props?.id ?? ownId;
  const { layer, handoff, light } = useFloatingTrigger({ now: Boolean(open || defaultOpen) });
  if (layer) {
    return (
      <layer.DialogLayer
        trigger={trigger}
        triggerId={triggerId}
        title={title}
        open={open}
        defaultOpen={defaultOpen}
        handoff={handoff}
        {...props}
      />
    );
  }
  return trigger ? light(trigger, lightDialogTrigger(triggerId)) : null;
}

/** A closed dialog's trigger, as Base UI draws it. */
export const lightDialogTrigger = (id) => ({
  id,
  'aria-haspopup': 'dialog',
  'aria-expanded': false,
});

/** Closes the dialog or drawer it sits in: `<DialogClose render={<Button>Cancel</Button>} />`. */
function DialogClose(props) {
  // Inside an open dialog or drawer, so the layer is in.
  const layer = useFloatingLayer();
  return layer ? <layer.DialogClose {...props} /> : null;
}

export { Dialog, DialogClose };
