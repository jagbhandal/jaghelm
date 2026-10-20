/*
 * Button (spec §5.4, #285): primary, secondary, ghost and danger, at sm and md,
 * as the signed-off mock draws them (its .jh-primary, .jh-btn and .jh-ghost):
 *
 *  - primary: the accent fill, on-accent text, bold; one per view at most.
 *  - secondary (the default): surface-1 inside a subtle edge, semibold; under
 *    the pointer the edge strengthens and the fill steps to surface-2.
 *  - ghost: no fill or edge, text-2; surface-2 and text-1 under the pointer.
 *    At sm it is the mock's row action (Edit, Remove, Sign out): 10px
 *    padding and a 6px radius. tone="accent" draws it in accent-text, which
 *    it keeps under the pointer, as the mock's Edit and Clear filter.
 *  - danger: the secondary's shape in crit's word colour and edge. It warns
 *    about an action, so it never takes crit's solid fill, which is a status.
 *
 * Heights are the mock's, h-control (34px) and h-control-sm (30px), in both
 * densities; so is each variant's padding. The focus ring is the base style's
 * (tailwind.css), which every control keeps. Built on Base UI's Button, which
 * keeps a disabled button out of the tab order. A link drawn as a button puts
 * `cn(buttonVariants(...))` on its <a>, through cn as Button does, so a
 * tone's text colour wins over its variant's (a bare buttonVariants() leaves
 * both, and the ghost's text-2 beats accent-text).
 */
import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva } from 'class-variance-authority';
import { cn } from './lib/utils.js';

const buttonVariants = cva(
  'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg text-body-sm whitespace-nowrap select-none transition-colors data-disabled:cursor-not-allowed data-disabled:opacity-55 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:stroke-[1.75]',
  {
    variants: {
      variant: {
        primary:
          'bg-accent font-bold text-on-accent shadow-control not-data-disabled:hover:bg-accent-hover',
        secondary:
          'border border-border bg-surface-1 font-semibold text-text-1 shadow-control not-data-disabled:hover:border-border-strong not-data-disabled:hover:bg-surface-2',
        ghost:
          'font-semibold text-text-2 not-data-disabled:hover:bg-surface-2 not-data-disabled:hover:text-text-1',
        danger:
          'border border-crit-border bg-surface-1 font-semibold text-crit-fg shadow-control not-data-disabled:hover:bg-surface-2',
      },
      size: {
        sm: "h-control-sm gap-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        md: "h-control gap-2 [&_svg:not([class*='size-'])]:size-4",
      },
      // Colours a ghost button only (compoundVariants); the others ignore it.
      tone: { neutral: '', accent: '' },
    },
    compoundVariants: [
      { variant: 'primary', size: 'md', class: 'px-3.5' },
      { variant: 'primary', size: 'sm', class: 'px-3' },
      { variant: ['secondary', 'danger'], size: 'md', class: 'px-3' },
      { variant: ['secondary', 'danger'], size: 'sm', class: 'px-2.5' },
      { variant: 'ghost', size: 'md', class: 'px-2.5' },
      { variant: 'ghost', size: 'sm', class: 'rounded-md px-2.5' },
      {
        variant: 'ghost',
        tone: 'accent',
        class: 'text-accent-text not-data-disabled:hover:text-accent-text',
      },
    ],
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
      tone: 'neutral',
    },
  }
);

function Button({ className, variant = 'secondary', size = 'md', tone = 'neutral', ...props }) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, tone }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
