/*
 * Toasts (spec §5.4, #286): short notes about something that just happened
 * ("Sent to 2 devices", "Couldn't save the checklist"), in the corner of the
 * screen. The mock draws none; they take its floating card's frame (surface-2
 * inside a strong edge, a 12px radius, shadow-pop), 360px wide at the bottom
 * right, inset by the page gutter, the newest nearest the corner; on a phone
 * they span the screen less the gutter. A toast has a title, an optional
 * description in text-2, an optional action (an accent ghost button, which
 * dismisses the toast once it has run) and a dismiss button. A `tone` other than neutral adds its status icon (the lamp's
 * shape in the word colour, lib/tone.jsx), so a failure never rests on colour.
 *
 * Base UI's Toast does the behaviour. The viewport is a polite live region,
 * a landmark named "Notifications" (F6 reaches it), so each toast is
 * announced when it appears. A `crit` toast is urgent: it is announced
 * assertively (role="alert") and stays until dismissed. Others go after 5
 * seconds, a timer that pauses while the pointer or focus is on them. A toast
 * can be swiped away. They rise 8px and fade in over 150ms (§5.3), or appear
 * at once with reduced motion asked for. At most three show at once.
 *
 * UiRoot (root.jsx) provides them, portalled as a `.jh-ui` root with its
 * switches: a toast has no anchor, so without that it would fall back to the
 * dark defaults (lib/portal.js). `useToast()` gives `add`, `update`, `close`
 * and `promise`; `add({ title, description, tone, action: { label, onClick },
 * timeout })` returns the toast's id. `createToastManager()` makes a manager
 * with the same four for code outside React, to hand to UiRoot as
 * `toastManager`.
 */
import { createContext, useContext, useMemo } from 'react';
import { Toast as ToastPrimitive } from '@base-ui/react/toast';
import { X } from 'lucide-react';
import { buttonVariants } from './button.jsx';
import { IconButton } from './icon-button.jsx';
import { cn } from './lib/utils.js';
import { usePortalRoot } from './lib/portal.js';
import { TONES, ToneIcon } from './lib/tone.jsx';

const ToastContext = createContext(null);

const NO_PROVIDER = 'useToast needs a UiRoot (or a ToastProvider) around it';

/** JagHelm's toast options as Base UI's: tone → type, action → actionProps. */
function toBaseOptions(options = {}, { defaults = false } = {}) {
  const { tone, action, ...rest } = options;
  const base = { ...rest };
  if (tone !== undefined) base.type = TONES.includes(tone) ? tone : undefined;
  if (action !== undefined) {
    base.actionProps = action ? { children: action.label, onClick: action.onClick } : undefined;
  }
  if (defaults && tone === 'crit') {
    // Urgent: announced at once, and left until it is dismissed.
    base.priority ??= 'high';
    base.timeout ??= 0;
  }
  return base;
}

const promiseState = (state) =>
  state && typeof state === 'object' && !Array.isArray(state)
    ? toBaseOptions(state, { defaults: true })
    : state;

function ToastViewport() {
  const [portalRoot] = usePortalRoot();
  const { toasts, close } = ToastPrimitive.useToastManager();
  return (
    <ToastPrimitive.Portal {...portalRoot}>
      <ToastPrimitive.Viewport
        data-slot="toast-viewport"
        className="fixed right-gutter bottom-gutter left-gutter z-toast flex flex-col-reverse gap-2 sm:left-auto sm:w-[360px]"
      >
        {toasts.map((toast) => (
          <ToastPrimitive.Root
            key={toast.id}
            toast={toast}
            data-slot="toast"
            className="flex items-start gap-3 rounded-xl border border-border-strong bg-surface-2 py-3 pr-2.5 pl-4 text-body-sm text-text-1 shadow-pop transition-[opacity,translate] data-ending-style:opacity-0 data-limited:hidden data-starting-style:translate-y-2 data-starting-style:opacity-0"
          >
            <ToneIcon tone={toast.type} className="mt-px" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-px">
              <ToastPrimitive.Title className="font-semibold break-words" />
              <ToastPrimitive.Description className="break-words text-text-2" />
            </div>
            {/* Runs the toast's action, then dismisses it. */}
            <ToastPrimitive.Action
              onClick={() => close(toast.id)}
              className={cn(
                buttonVariants({ variant: 'ghost', size: 'sm', tone: 'accent' }),
                '-my-1'
              )}
            />
            <ToastPrimitive.Close
              render={
                <IconButton label="Dismiss" size="sm" className="-my-1">
                  <X />
                </IconButton>
              }
            />
          </ToastPrimitive.Root>
        ))}
      </ToastPrimitive.Viewport>
    </ToastPrimitive.Portal>
  );
}

/** Base UI's manager behind one of ours. */
const BASE = Symbol('base toast manager');

let lastId = 0;

/**
 * Base UI's manager drops what is sent before its provider subscribes, and the
 * provider subscribes in an effect, after its children's effects have run: a
 * toast added as a screen mounts (a failed first load) would be lost. This one
 * holds what it is sent until a provider listens, then passes it on in order.
 */
function createBufferedManager() {
  const base = ToastPrimitive.createToastManager();
  const held = [];
  let listening = 0;
  const send = (call) => (listening > 0 ? call() : void held.push(call));
  return {
    ' subscribe'(listener) {
      const unsubscribe = base[' subscribe'](listener);
      listening += 1;
      for (const call of held.splice(0)) call();
      return () => {
        listening -= 1;
        unsubscribe();
      };
    },
    add(options) {
      const toast = { ...options, id: options.id ?? `jh-toast-${(lastId += 1)}` };
      send(() => base.add(toast));
      return toast.id;
    },
    close: (id) => send(() => base.close(id)),
    update: (id, updates) => send(() => base.update(id, updates)),
    promise: (promise, options) => send(() => base.promise(promise, options)) ?? promise,
  };
}

/**
 * A toast manager: `add`, `update`, `close` and `promise`, taking JagHelm's
 * options. Make one to queue toasts from code outside React, and give it to
 * UiRoot as `toastManager`; UiRoot makes its own otherwise. What it is sent
 * before UiRoot mounts shows once it has.
 */
function createToastManager() {
  const manager = createBufferedManager();
  return Object.freeze({
    add: (options) => manager.add(toBaseOptions(options, { defaults: true })),
    update: (id, options) => manager.update(id, toBaseOptions(options)),
    close: (id) => manager.close(id),
    promise: (promise, { loading, success, error } = {}) =>
      manager.promise(promise, {
        loading: promiseState(loading),
        success:
          typeof success === 'function' ? (v) => promiseState(success(v)) : promiseState(success),
        error: typeof error === 'function' ? (e) => promiseState(error(e)) : promiseState(error),
      }),
    [BASE]: manager,
  });
}

function ToastProvider({ toastManager, limit = 3, timeout = 5000, children }) {
  const toasts = useMemo(() => toastManager ?? createToastManager(), [toastManager]);
  return (
    <ToastPrimitive.Provider toastManager={toasts[BASE]} limit={limit} timeout={timeout}>
      <ToastContext.Provider value={toasts}>
        {children}
        <ToastViewport />
      </ToastContext.Provider>
    </ToastPrimitive.Provider>
  );
}

/** `{ add, update, close, promise }` for the toasts of the UiRoot around. */
function useToast() {
  const api = useContext(ToastContext);
  if (!api) throw new Error(NO_PROVIDER);
  return api;
}

export { ToastProvider, useToast, createToastManager };
