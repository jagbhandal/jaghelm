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
 * title, or, without one, by an `aria-label` or else by its trigger (the
 * grouping popover is "Group: Node", as its button), so it is never unnamed;
 * focus moves into it, Escape or a click outside closes it, and focus
 * returns to the trigger. `openOnHover` also opens it under the pointer (an
 * infotip: Base UI's advice for help behind an icon, which a tooltip would
 * hide from touch and screen reader users). It fades over 150ms (§5.3), or
 * appears at once with reduced motion asked for, and is portalled as a
 * `.jh-ui` root with the screen's switches (lib/portal.js).
 *
 * Base UI's part loads with the floating layer, on first use
 * (lib/floating.jsx; floating/popover.jsx). Until then the trigger is drawn
 * here as a closed popover's (aria-haspopup, aria-expanded), and a click on it
 * opens the popover as soon as the layer is in.
 */
import { useId } from 'react';
import { useFloatingLayer, useFloatingTrigger } from './lib/floating.jsx';

function Popover({ trigger, open, defaultOpen, ...props }) {
  const ownId = useId();
  const triggerId = trigger?.props?.id ?? ownId;
  const { layer, handoff, light } = useFloatingTrigger({ now: Boolean(open || defaultOpen) });
  if (layer) {
    return (
      <layer.PopoverLayer
        trigger={trigger}
        triggerId={triggerId}
        open={open}
        defaultOpen={defaultOpen}
        handoff={handoff}
        {...props}
      />
    );
  }
  return trigger
    ? light(trigger, { id: triggerId, 'aria-haspopup': 'dialog', 'aria-expanded': false })
    : null;
}

/** Closes the popover it sits in: `<PopoverClose render={<Button size="sm">Done</Button>} />`. */
function PopoverClose(props) {
  // Inside an open popover, so the layer is in.
  const layer = useFloatingLayer();
  return layer ? <layer.PopoverClose {...props} /> : null;
}

export { Popover, PopoverClose };
