/*
 * IconButton (spec §5.4, #285): a square Button that shows only an icon, as the
 * mock's theme, reload and close buttons: 34px (size-control) or 30px at sm, in
 * both densities, with the 8px radius at either size. Ghost by default, as the
 * mock draws every one; the Button's other variants work too. An icon has no
 * name, so `label` is required: it becomes the accessible name. Without one (or
 * an aria-label or aria-labelledby) it throws in development, so the mistake
 * shows at once; in a production build it logs the error instead, so a label
 * read from data that comes back empty doesn't take the screen down with it.
 */
import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { buttonVariants } from './button.jsx';
import { cn } from './lib/utils.js';

const squares = {
  sm: 'size-control-sm rounded-lg px-0',
  md: 'size-control rounded-lg px-0',
};

const NO_NAME = 'IconButton needs a `label`: an icon alone has no name';

function IconButton({
  label,
  variant = 'ghost',
  size = 'md',
  tone = 'neutral',
  className,
  ...props
}) {
  if (!label && !props['aria-label'] && !props['aria-labelledby']) {
    if (import.meta.env.DEV) throw new Error(NO_NAME);
    console.error(NO_NAME);
  }
  return (
    <ButtonPrimitive
      data-slot="icon-button"
      aria-label={label || undefined}
      className={cn(buttonVariants({ variant, size, tone }), squares[size], className)}
      {...props}
    />
  );
}

export { IconButton };
