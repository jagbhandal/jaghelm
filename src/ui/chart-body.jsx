/*
 * The parts of a Monitoring chart's body beside its plot (#753): `ChartBody`
 * stacks what a Panel holds (tiles, the plot, a line of figures, a footnote)
 * 12px apart; `ChartNote` is a line under the plot in 12px `text-2` (a
 * footnote, the lowest and highest); `ChartLink` is a link in the accent text
 * colour, underlined on hover and focus, such as the one to a setting an empty
 * chart needs. The shell screens use these, not utility classes of their own.
 */
import { cn } from './lib/utils.js';

function ChartBody({ className, ...props }) {
  return <div data-slot="chart-body" className={cn('flex flex-col gap-3', className)} {...props} />;
}

function ChartNote({ className, ...props }) {
  return <p data-slot="chart-note" className={cn('text-caption text-text-2', className)} {...props} />;
}

function ChartLink({ className, ...props }) {
  return (
    <a
      data-slot="chart-link"
      className={cn(
        'rounded-xs font-semibold text-accent-text underline-offset-2 hover:underline focus-visible:underline',
        className
      )}
      {...props}
    />
  );
}

export { ChartBody, ChartNote, ChartLink };
