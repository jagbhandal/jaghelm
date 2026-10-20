/*
 * The status tones a Banner or a toast takes, and the icon each one shows.
 * Status is always a word, a colour and a shape together
 * (docs/design-system.md, rule 3), so each state's icon is its StatusLamp:
 * 14px and decorative, as the mock's drawer box draws it, in the state's
 * `solid` with the cut in `lamp-cut`. Info is not a state and has no lamp: it
 * shows Lucide's "i" at the lamps' size, so titles line up, in its word colour
 * (`fg`), which carries 4.5:1 on the page, the panels and its own tint.
 */
import { Info } from 'lucide-react';
import { StatusLamp } from '../status-lamp.jsx';
import { cn } from './utils.js';

export const TONES = Object.freeze(['ok', 'warn', 'crit', 'unknown', 'maintenance', 'info']);

const STATES = new Set(['ok', 'warn', 'crit', 'unknown', 'maintenance']);

/** The icon for `tone`; nothing for a tone it doesn't know. */
export function ToneIcon({ tone, className }) {
  if (STATES.has(tone)) {
    return <StatusLamp state={tone} size="lg" decorative data-tone={tone} className={className} />;
  }
  if (tone !== 'info') return null;
  return (
    <Info
      aria-hidden="true"
      data-tone={tone}
      strokeWidth={1.75}
      className={cn('size-3.5 shrink-0 text-info-fg', className)}
    />
  );
}
