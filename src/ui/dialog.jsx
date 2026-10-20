/*
 * Dialog (spec §5.4, #286): a modal over the screen, for a short task or a
 * message that needs an answer before the person goes on. It is drawn as the
 * mock's command palette, its one modal: surface-1 inside a strong edge, a
 * 12px radius, shadow-pop over the scrim, 96px from the top and centred,
 * never wider than the screen less 16px a side. Its content is laid out as the
 * mock's "won't open inside JagHelm" card: 24px of padding, the title (20/26
 * bold), the description in text-2 and the content, 12px apart, and the
 * actions in a row under them, the main one first (the mock's order). A ghost
 * close button sits top right, beside the title, as the drawer's does.
 *
 * Base UI's Dialog does the behaviour: focus moves into the dialog and stays
 * there (Tab and Shift+Tab cycle inside it), Escape or a click on the scrim
 * closes it, focus goes back to whatever opened it, the page under it is inert
 * and stops scrolling, and the title and description name and describe it.
 *
 * It fades in and out over 150ms (§5.3), the scrim with it; with reduced motion
 * asked for, the base style cuts that to nothing (tailwind.css). It is
 * portalled as a `.jh-ui` root carrying the screen's switches, taken from its
 * trigger, or from the UiRoot when it has none (lib/portal.js).
 *
 * `trigger` is the element that opens it (a Button); without one, control it
 * with `open` and `onOpenChange`. `footer` holds the actions; a DialogClose
 * closes it from one of them. The Drawer and the Confirm reuse its layer.
 */
import { useRef } from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { cva } from 'class-variance-authority';
import { X } from 'lucide-react';
import { IconButton } from './icon-button.jsx';
import { cn } from './lib/utils.js';
import { useOverlayPortal } from './lib/portal.js';

const popupVariants = cva(
  'fixed z-dialog flex flex-col overflow-y-auto overscroll-contain bg-surface-1 text-body text-text-1 shadow-pop',
  {
    variants: {
      placement: {
        // The command palette's place and frame; it fades.
        center:
          'top-24 left-1/2 max-h-[calc(100dvh-8rem)] max-w-[calc(100vw-2rem)] -translate-x-1/2 gap-3 rounded-xl border border-border-strong p-6 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0',
        // The mock's detail drawer: the full height on the right, 460px or the
        // whole screen if narrower, a subtle left edge; it slides in.
        right:
          'inset-y-0 right-0 w-[460px] max-w-full border-l border-border transition-transform data-ending-style:translate-x-full data-starting-style:translate-x-full',
      },
      size: {
        sm: 'w-[440px]',
        md: 'w-[540px]',
        lg: 'w-[600px]',
        none: '',
      },
    },
    defaultVariants: { placement: 'center', size: 'md' },
  }
);

/**
 * The modal layer the Dialog, the Drawer and the Confirm share, inside their
 * Base UI Root: the portal (a `.jh-ui` root, `portalRoot`), the scrim and the
 * popup. Not for screens: use one of those three.
 */
function DialogLayer({ portalRoot, placement, size, className, children, ...props }) {
  return (
    <DialogPrimitive.Portal {...portalRoot}>
      <DialogPrimitive.Backdrop
        data-slot="scrim"
        className="fixed inset-0 z-overlay bg-scrim transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0"
      />
      <DialogPrimitive.Popup
        className={cn(popupVariants({ placement, size }), className)}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

/** The ghost close button at the top right of a dialog or drawer. */
function CloseButton({ label, size, className }) {
  return (
    <DialogPrimitive.Close
      render={
        <IconButton label={label} size={size} className={cn('shrink-0', className)}>
          <X />
        </IconButton>
      }
    />
  );
}

function Dialog({
  trigger,
  title,
  description,
  footer,
  size = 'md',
  closeLabel = 'Close',
  open,
  defaultOpen,
  onOpenChange,
  onOpenChangeComplete,
  initialFocus,
  finalFocus,
  className,
  children,
  ...props
}) {
  const triggerRef = useRef(null);
  const [portalRoot, openChange] = useOverlayPortal(triggerRef, open, onOpenChange);
  return (
    <DialogPrimitive.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={openChange}
      onOpenChangeComplete={onOpenChangeComplete}
    >
      {trigger ? <DialogPrimitive.Trigger ref={triggerRef} render={trigger} /> : null}
      <DialogLayer
        portalRoot={portalRoot}
        placement="center"
        size={size}
        data-slot="dialog"
        initialFocus={initialFocus}
        finalFocus={finalFocus}
        className={className}
        {...props}
      >
        <div className="flex items-start gap-3">
          <DialogPrimitive.Title className="min-w-0 flex-1 text-title text-text-1">
            {title}
          </DialogPrimitive.Title>
          <CloseButton label={closeLabel} size="sm" className="-mt-0.5 -mr-2" />
        </div>
        {description != null ? (
          <DialogPrimitive.Description className="text-text-2">
            {description}
          </DialogPrimitive.Description>
        ) : null}
        {children}
        {footer != null ? (
          <div data-slot="dialog-footer" className="flex flex-wrap items-center gap-2 pt-1">
            {footer}
          </div>
        ) : null}
      </DialogLayer>
    </DialogPrimitive.Root>
  );
}

/** Closes the dialog or drawer it sits in: `<DialogClose render={<Button>Cancel</Button>} />`. */
const DialogClose = DialogPrimitive.Close;

export { Dialog, DialogClose, DialogLayer, CloseButton };
