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
 * assertively (role="alert") and stays until dismissed, whether it was added
 * so, updated to crit, or a promise that failed. Others go after 5 seconds, a
 * timer that pauses while the pointer or focus is on them. A toast can be
 * swiped away. They rise 8px and fade in over 150ms (§5.3), or appear at once
 * with reduced motion asked for. At most three show at once.
 *
 * A page has one viewport, however many UiRoots it holds (root.jsx): the
 * first UiRoot at the top of the page (not inside another) renders it, with
 * its switches, and it shows the toasts of every root on the page. A UiRoot
 * inside another uses the outer one's toasts, and a manager several roots
 * share shows each toast once. A toast has no anchor, so without those
 * switches it would fall back to the dark defaults (lib/portal.js).
 *
 * `useToast()` gives `add`, `update`, `close` and `promise`; `add({ title,
 * description, tone, action: { label, onClick }, timeout, id })` returns the
 * toast's id. Give a toast added from an effect an `id`: React's StrictMode
 * runs effects twice in development, and with an id the second run updates
 * the toast in place instead of showing it twice. `update(id, { tone })` gives
 * the toast that tone's urgency. `promise(promise, { loading, success, error
 * })` shows `loading` until the promise settles, then `success` (ok unless it
 * names a tone) or `error` (crit unless it names one); a state given as a
 * string is its title. `createToastManager()` makes a manager with the same
 * four for code outside React, to hand to UiRoot as `toastManager`; what it is
 * sent before a UiRoot listens is held, and a held toast that isn't crit is
 * dropped once it is older than its timeout, rather than shown late.
 */
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { Toast as ToastPrimitive } from '@base-ui/react/toast';
import { X } from 'lucide-react';
import { buttonVariants } from './button.jsx';
import { IconButton } from './icon-button.jsx';
import { cn } from './lib/utils.js';
import { usePortalRoot } from './lib/portal.js';
import { TONES, ToneIcon } from './lib/tone.jsx';

const ToastContext = createContext(null);

const NO_PROVIDER = 'useToast needs a UiRoot (or a ToastProvider) around it';

/** How long a toast stays when neither it nor its tone says (ToastProvider's default). */
const DEFAULT_TIMEOUT = 5000;

/**
 * JagHelm's toast options as Base UI's: action → actionProps, and tone → the
 * toast's `data.tone`, which Base UI keeps through updates (its own `type` a
 * promise overwrites). A tone also sets how urgent the toast is, unless the
 * options say: crit is announced at once (`priority: 'high'`) and stays until
 * dismissed (`timeout: 0`); any other tone, or none (`tone: null`), is polite
 * and goes after the timeout, so an update can make a toast urgent and back.
 */
function toBaseOptions(options = {}) {
  const { tone, action, ...rest } = options;
  const base = { ...rest };
  if (tone !== undefined) {
    const known = TONES.includes(tone) ? tone : null;
    base.data = { ...rest.data, tone: known };
    if (!Object.hasOwn(rest, 'priority')) base.priority = known === 'crit' ? 'high' : 'low';
    if (!Object.hasOwn(rest, 'timeout')) base.timeout = known === 'crit' ? 0 : undefined;
  }
  if (action !== undefined) {
    base.actionProps = action ? { children: action.label, onClick: action.onClick } : undefined;
  }
  return base;
}

/**
 * One of promise()'s states as Base UI's: a string is the title, and a
 * settled state without a tone takes `fallback` (ok for success, crit for an
 * error), so it shows its icon and an error is urgent. A settled state left
 * out keeps the loading toast's words and takes the tone.
 */
function promiseState(state, fallback) {
  if (typeof state === 'function') return (value) => promiseState(state(value), fallback);
  const options = typeof state === 'string' ? { title: state } : (state ?? (fallback && {}));
  if (!options || typeof options !== 'object') return options;
  return toBaseOptions(
    fallback && options.tone === undefined ? { ...options, tone: fallback } : options
  );
}

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
            <ToneIcon tone={toast.data?.tone} className="mt-px" />
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
 * A held toast that isn't crit and is older than its timeout is dropped: no
 * UiRoot was there to show it in time (a legacy screen), and it would arrive
 * stale on the next new one.
 */
function createBufferedManager() {
  const base = ToastPrimitive.createToastManager();
  const held = [];
  let listening = 0;
  const send = (call, expires = Infinity) =>
    listening > 0 ? call() : void held.push({ call, expires });
  return {
    ' subscribe'(listener) {
      const unsubscribe = base[' subscribe'](listener);
      listening += 1;
      const now = Date.now();
      for (const { call, expires } of held.splice(0)) if (expires > now) call();
      return () => {
        listening -= 1;
        unsubscribe();
      };
    },
    add(options) {
      const toast = { ...options, id: options.id ?? `jh-toast-${(lastId += 1)}` };
      const timeout = toast.timeout ?? DEFAULT_TIMEOUT;
      send(() => base.add(toast), timeout > 0 ? Date.now() + timeout : Infinity);
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
 * before a UiRoot listens shows once one does.
 */
function createToastManager() {
  const manager = createBufferedManager();
  return Object.freeze({
    add: (options) => manager.add(toBaseOptions(options)),
    update: (id, options) => manager.update(id, toBaseOptions(options)),
    close: (id) => manager.close(id),
    promise: (promise, { loading, success, error } = {}) =>
      manager.promise(promise, {
        loading: promiseState(loading),
        success: promiseState(success, 'ok'),
        error: promiseState(error, 'crit'),
      }),
    [BASE]: manager,
  });
}

/**
 * The page's toasts: one viewport per document, however many UiRoots it
 * holds. Each root's manager is registered here (a manager two roots share,
 * once), and the one viewport listens to all of them through `hub`, which
 * Base UI's provider takes as its manager. The roots at the top of the page
 * are its hosts, in the order they mounted; the first renders the viewport,
 * and the next takes over if it unmounts.
 */
function createPageToasts() {
  const managers = new Map(); // a manager → how many roots registered it
  const listeners = new Map(); // a viewport's listener → its unsubscribe from each manager
  const hosts = [];
  const watchers = new Set();
  const changed = () => watchers.forEach((watch) => watch());
  return {
    hub: Object.freeze({
      ' subscribe'(listener) {
        const subscriptions = new Map();
        listeners.set(listener, subscriptions);
        for (const manager of managers.keys()) {
          subscriptions.set(manager, manager[' subscribe'](listener));
        }
        return () => {
          listeners.delete(listener);
          for (const unsubscribe of subscriptions.values()) unsubscribe();
        };
      },
    }),
    register(manager) {
      const count = managers.get(manager) ?? 0;
      managers.set(manager, count + 1);
      if (count === 0) {
        for (const [listener, subscriptions] of listeners) {
          subscriptions.set(manager, manager[' subscribe'](listener));
        }
      }
      return () => {
        const left = managers.get(manager) - 1;
        if (left > 0) return void managers.set(manager, left);
        managers.delete(manager);
        for (const subscriptions of listeners.values()) {
          subscriptions.get(manager)?.();
          subscriptions.delete(manager);
        }
      };
    },
    host(token) {
      hosts.push(token);
      changed();
      return () => {
        hosts.splice(hosts.indexOf(token), 1);
        changed();
      };
    },
    watch(watcher) {
      watchers.add(watcher);
      return () => watchers.delete(watcher);
    },
    firstHost: () => hosts[0] ?? null,
  };
}

const page = createPageToasts();

/** The page's one viewport, listening to every root's manager. */
function PageToasts({ limit, timeout }) {
  return (
    <ToastPrimitive.Provider toastManager={page.hub} limit={limit} timeout={timeout}>
      <ToastViewport />
    </ToastPrimitive.Provider>
  );
}

/**
 * The toasts of a UiRoot (root.jsx): `useToast()` inside it reaches
 * `toastManager`, or one of its own, or, inside another UiRoot, that root's.
 * At the top of the page, it may host the page's one viewport.
 */
function ToastProvider({ toastManager, limit = 3, timeout = DEFAULT_TIMEOUT, children }) {
  const outer = useContext(ToastContext);
  const own = useMemo(
    () => toastManager ?? (outer ? null : createToastManager()),
    [toastManager, outer]
  );
  const [token] = useState(() => ({}));
  const top = outer == null;
  useLayoutEffect(() => (own ? page.register(own[BASE]) : undefined), [own]);
  useLayoutEffect(() => (top ? page.host(token) : undefined), [top, token]);
  const host = useSyncExternalStore(page.watch, page.firstHost, page.firstHost);
  return (
    <ToastContext.Provider value={own ?? outer}>
      {children}
      {host === token ? <PageToasts limit={limit} timeout={timeout} /> : null}
    </ToastContext.Provider>
  );
}

/** `{ add, update, close, promise }` for the toasts of the UiRoot around. */
function useToast() {
  const api = useContext(ToastContext);
  if (!api) throw new Error(NO_PROVIDER);
  return api;
}

export { ToastProvider, useToast, createToastManager };
