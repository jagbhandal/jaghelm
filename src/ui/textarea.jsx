/*
 * Textarea (#331): Input's multi-line sibling, for text a person pastes, such as
 * a theme's JSON (Settings → Appearance → Custom themes). The same field as
 * Input: the page colour inside a strong edge, 13px text, the focus ring 1px
 * out, an invalid edge in crit-border. It is Base UI's Input rendered as a
 * <textarea>, so inside a Field it takes the field's label, help text and error
 * as Input does. `mono` sets the monospace face, for code and data.
 */
import { Input as InputPrimitive } from '@base-ui/react/input';
import { cn } from './lib/utils.js';

function Textarea({ mono, className, ...props }) {
  return (
    <InputPrimitive
      render={<textarea />}
      data-slot="textarea"
      spellCheck={false}
      className={cn(
        'min-h-32 w-full min-w-0 resize-y rounded-lg border border-border-strong bg-background px-2.5 py-2 text-body-sm text-text-1 transition-colors placeholder:text-text-3 focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:opacity-55 aria-invalid:border-crit-border',
        mono && 'font-mono',
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
