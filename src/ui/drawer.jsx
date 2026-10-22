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
 *
 * Base UI's part loads with the floating layer, as the Dialog's does
 * (dialog.jsx; floating/drawer.jsx).
 */
import { useId } from 'react';
import { requireName } from './lib/name.js';
import { useFloatingTrigger } from './lib/floating.jsx';
import { lightDialogTrigger } from './dialog.jsx';

function Drawer({ trigger, title, open, defaultOpen, ...props }) {
  requireName('Drawer', { title, open, props });
  const ownId = useId();
  const triggerId = trigger?.props?.id ?? ownId;
  const { layer, handoff, light } = useFloatingTrigger({ now: Boolean(open || defaultOpen) });
  if (layer) {
    return (
      <layer.DrawerLayer
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

export { Drawer };
export { DialogClose as DrawerClose } from './dialog.jsx';
