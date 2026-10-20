/**
 * An overlay's name (#286). A dialog without one is announced as just
 * "dialog", and axe fails it. The Dialog, the Drawer and the Confirm take
 * theirs from `title`; the Dialog and the Drawer accept an `aria-label` (or
 * `aria-labelledby`) instead. The Popover, whose title is optional, is named
 * by its trigger without either (popover.jsx).
 */

/** Whether `node` would show something: not null, false, or a blank string. */
export const hasText = (node) =>
  node != null && node !== false && !(typeof node === 'string' && !node.trim());

/**
 * Throws in development, and logs in production, when the overlay would have
 * no name, as an IconButton without a label does. `props` holds the overlay's
 * other props, for an `aria-label`; leave it out where none is taken. Checked
 * while it can show: a closed controlled one (`open={false}`) may hold an
 * empty title.
 */
export function requireName(component, { title, open, props = null }) {
  if (open === false || hasText(title)) return;
  if (props && (hasText(props['aria-label']) || props['aria-labelledby'])) return;
  const message = props
    ? `${component} needs a \`title\`, or an \`aria-label\` without one: it has no name`
    : `${component} needs a \`title\`: it has no name`;
  if (import.meta.env.DEV) throw new Error(message);
  console.error(message);
}
