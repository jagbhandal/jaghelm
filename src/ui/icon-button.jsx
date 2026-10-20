/*
 * IconButton (spec §5.4, #285): a square Button that shows only an icon, as the
 * mock's theme, reload and close buttons: 34px (size-control) or 30px at sm,
 * following the density switch. Ghost by default, as the mock draws every one;
 * the Button's other variants work too. An icon has no name, so `label` is
 * required: it becomes the accessible name, and the component throws without
 * one (or an aria-labelledby) rather than ship a button nobody can identify.
 */
import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { buttonVariants } from './button.jsx';
import { cn } from './lib/utils.js';

const squares = {
  sm: 'size-control-sm px-0',
  md: 'size-control px-0',
};

function IconButton({ label, variant = 'ghost', size = 'md', className, ...props }) {
  if (!label && !props['aria-labelledby']) {
    throw new Error('IconButton needs a `label` (or aria-labelledby): an icon alone has no name');
  }
  return (
    <ButtonPrimitive
      data-slot="icon-button"
      aria-label={label || undefined}
      className={cn(buttonVariants({ variant, size }), squares[size], className)}
      {...props}
    />
  );
}

export { IconButton };
