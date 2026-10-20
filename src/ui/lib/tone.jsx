/*
 * The status tones a Banner or a toast takes, and the icon each one shows.
 * Status is always a word, a colour and a shape together
 * (docs/design-system.md, rule 3), so each tone's icon echoes its lamp's
 * shape: a filled disc for ok, a slashed disc for warn, a disc with a bar for
 * crit, a hollow ring for no signal, a wrench for maintenance. Info is not a
 * state and has no lamp: it shows an "i". The icon is in the tone's word
 * colour (`fg`), which carries 4.5:1 on the page, the panels and its own tint.
 *
 * These are Lucide outlines. The shared StatusLamp (#287) can take their place
 * once it is in src/ui/.
 */
import { Circle, CircleMinus, CircleSlash, Info, Wrench } from 'lucide-react';
import { cn } from './utils.js';

export const TONES = Object.freeze(['ok', 'warn', 'crit', 'unknown', 'maintenance', 'info']);

const ICONS = {
  ok: Circle,
  warn: CircleSlash,
  crit: CircleMinus,
  unknown: Circle,
  maintenance: Wrench,
  info: Info,
};

const colours = {
  ok: 'fill-current text-ok-fg',
  warn: 'text-warn-fg',
  crit: 'text-crit-fg',
  unknown: 'text-unknown-fg',
  maintenance: 'text-maintenance-fg',
  info: 'text-info-fg',
};

/** The icon for `tone`, in its word colour; nothing for a tone it doesn't know. */
export function ToneIcon({ tone, className }) {
  const Icon = ICONS[tone];
  if (!Icon) return null;
  return (
    <Icon
      aria-hidden="true"
      data-tone={tone}
      strokeWidth={1.75}
      className={cn('size-4 shrink-0', colours[tone], className)}
    />
  );
}
