import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/**
 * OverlayContext — one provider for the two app-global transient UI surfaces:
 * ephemeral toasts and a promise-based confirm modal. App mounts it once so any
 * component can useToast() / useConfirm() without prop-drilling a notifier.
 * Styles are inline and read the theme's CSS custom properties.
 *
 * Accessibility: toasts are role=status (errors role=alert — see Toast); the
 * confirm modal is role=dialog aria-modal, focus-trapped, Escape cancels, and
 * focus returns to the trigger on close. prefers-reduced-motion drops transitions.
 */

const ToastContext = createContext(null);
const ConfirmContext = createContext(null);

const TOAST_TTL_MS = 4000;

// Per-type accent token + glyph. 'info' falls back to the theme accent.
const TOAST_KINDS = {
  success: {
    color: 'var(--green)',
    bg: 'var(--green-bg)',
    border: 'var(--green-border)',
    glyph: '✓',
  },
  error: { color: 'var(--red)', bg: 'var(--red-bg)', border: 'var(--red-border)', glyph: '✕' },
  info: {
    color: 'var(--accent)',
    bg: 'var(--accent-glow)',
    border: 'var(--border-glow)',
    glyph: 'ℹ',
  },
};

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e) => setReduced(e.matches);
    // addEventListener is the modern API; older Safari needs addListener.
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, []);
  return reduced;
}

export function OverlayProvider({ children }) {
  const reducedMotion = usePrefersReducedMotion();

  // Toasts
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());
  const idRef = useRef(0);

  const dismissToast = useCallback((id) => {
    const t = timersRef.current.get(id);
    if (t) {
      clearTimeout(t);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback(
    (message, type = 'info') => {
      if (message == null || message === '') return -1;
      const id = ++idRef.current;
      const kind = TOAST_KINDS[type] ? type : 'info';
      setToasts((prev) => [...prev, { id, message: String(message), type: kind }]);
      const timer = setTimeout(() => dismissToast(id), TOAST_TTL_MS);
      timersRef.current.set(id, timer);
      return id;
    },
    [dismissToast]
  );

  // Clear all pending timers on unmount so a torn-down provider can't fire.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  // Confirm. `confirmState` is null when idle; otherwise the live dialog props
  // plus the resolver that settles the awaited promise.
  const [confirmState, setConfirmState] = useState(null);
  const resolverRef = useRef(null);
  const triggerElRef = useRef(null);

  const settle = useCallback((result) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setConfirmState(null);
    // Restore focus to whatever element opened the dialog.
    const trigger = triggerElRef.current;
    triggerElRef.current = null;
    if (trigger && typeof trigger.focus === 'function') {
      // Defer so focus lands after the dialog has unmounted.
      requestAnimationFrame(() => trigger.focus());
    }
    if (resolve) resolve(result);
  }, []);

  const confirm = useCallback((opts = {}) => {
    // Record the trigger element so focus can return to it on close.
    triggerElRef.current = typeof document !== 'undefined' ? document.activeElement : null;
    return new Promise((resolve) => {
      // If a confirm is somehow already open, resolve it false first.
      if (resolverRef.current) resolverRef.current(false);
      resolverRef.current = resolve;
      setConfirmState({
        title: opts.title || 'Are you sure?',
        body: opts.body ?? '',
        confirmLabel: opts.confirmLabel || 'Confirm',
        cancelLabel: opts.cancelLabel || 'Cancel',
        danger: !!opts.danger,
      });
    });
  }, []);

  const toastApi = useMemo(() => ({ toast }), [toast]);
  const confirmApi = useMemo(() => ({ confirm }), [confirm]);

  return (
    <ToastContext.Provider value={toastApi}>
      <ConfirmContext.Provider value={confirmApi}>
        {children}
        <ToastStack toasts={toasts} onDismiss={dismissToast} reducedMotion={reducedMotion} />
        {confirmState && (
          <ConfirmModal
            {...confirmState}
            reducedMotion={reducedMotion}
            onConfirm={() => settle(true)}
            onCancel={() => settle(false)}
          />
        )}
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  );
}

// Toast stack — fixed top-right, newest on top, each auto-dismisses.
function ToastStack({ toasts, onDismiss, reducedMotion }) {
  if (toasts.length === 0) return null;
  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        maxWidth: 'min(360px, calc(100vw - 32px))',
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={onDismiss} reducedMotion={reducedMotion} />
      ))}
    </div>
  );
}

function Toast({ toast, onDismiss, reducedMotion }) {
  const kind = TOAST_KINDS[toast.type] || TOAST_KINDS.info;
  const [shown, setShown] = useState(reducedMotion);
  useEffect(() => {
    if (reducedMotion) return undefined;
    const r = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(r);
  }, [reducedMotion]);

  return (
    <div
      // Errors announce assertively (role=alert ⇒ aria-live=assertive) so a
      // failed save/import is heard before the toast auto-dismisses; others polite.
      role={toast.type === 'error' ? 'alert' : 'status'}
      style={{
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '12px 14px',
        background: 'var(--bg-card)',
        color: 'var(--text-primary)',
        border: `1px solid ${kind.border}`,
        borderLeft: `3px solid ${kind.color}`,
        borderRadius: 10,
        boxShadow: 'var(--shadow-card, 0 4px 24px rgba(0,0,0,0.3))',
        backdropFilter: 'blur(var(--glass-blur, 12px))',
        WebkitBackdropFilter: 'blur(var(--glass-blur, 12px))',
        font: '14px var(--font-body, sans-serif)',
        lineHeight: 1.4,
        transform: shown ? 'translateX(0)' : 'translateX(16px)',
        opacity: shown ? 1 : 0,
        transition: reducedMotion ? 'none' : 'transform 180ms ease, opacity 180ms ease',
      }}
    >
      <span aria-hidden="true" style={{ color: kind.color, fontWeight: 700, lineHeight: 1.4 }}>
        {kind.glyph}
      </span>
      <span style={{ flex: 1, wordBreak: 'break-word' }}>{toast.message}</span>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        style={{
          flexShrink: 0,
          background: 'transparent',
          border: 'none',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          fontSize: 16,
          lineHeight: 1,
          padding: 0,
          marginTop: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}

// Confirm modal — focus-trapped, Escape cancels, role=dialog.
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

function ConfirmModal({
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger,
  reducedMotion,
  onConfirm,
  onCancel,
}) {
  const dialogRef = useRef(null);
  const confirmBtnRef = useRef(null);
  const titleId = useRef(`overlay-confirm-title-${Math.random().toString(36).slice(2)}`).current;
  const bodyId = useRef(`overlay-confirm-body-${Math.random().toString(36).slice(2)}`).current;

  // Focus the confirm button on open (the primary action), once.
  useEffect(() => {
    const btn = confirmBtnRef.current;
    if (btn) btn.focus();
  }, []);

  // Escape cancels; Tab is trapped within the dialog.
  const onKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const nodes = Array.from(root.querySelectorAll(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );
      if (nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onCancel]
  );

  const accent = danger ? 'var(--red)' : 'var(--accent)';

  return (
    <div
      // Backdrop. Click outside the panel cancels.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
        animation: reducedMotion ? 'none' : undefined,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={body ? bodyId : undefined}
        onKeyDown={onKeyDown}
        style={{
          width: 'min(440px, 100%)',
          maxHeight: 'calc(100vh - 32px)',
          overflowY: 'auto',
          background: 'var(--bg-card)',
          color: 'var(--text-primary)',
          border: `1px solid ${danger ? 'var(--red-border)' : 'var(--border-color)'}`,
          borderTop: `3px solid ${accent}`,
          borderRadius: 12,
          boxShadow: 'var(--shadow-card, 0 8px 40px rgba(0,0,0,0.5))',
          backdropFilter: 'blur(var(--glass-blur, 24px))',
          WebkitBackdropFilter: 'blur(var(--glass-blur, 24px))',
          padding: '20px 22px',
          font: '14px var(--font-body, sans-serif)',
          transform: reducedMotion ? 'none' : 'scale(1)',
        }}
      >
        <h2
          id={titleId}
          style={{
            margin: '0 0 8px',
            fontSize: 18,
            fontWeight: 600,
            fontFamily: 'var(--font-display, sans-serif)',
            color: danger ? 'var(--red)' : 'var(--text-primary)',
          }}
        >
          {title}
        </h2>
        {body ? (
          <div
            id={bodyId}
            style={{ margin: '0 0 18px', color: 'var(--text-secondary)', lineHeight: 1.5 }}
          >
            {body}
          </div>
        ) : (
          <div style={{ height: 8 }} />
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid var(--border-color)',
              background: 'transparent',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              font: 'inherit',
              fontWeight: 500,
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            ref={confirmBtnRef}
            onClick={onConfirm}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: `1px solid ${danger ? 'var(--red)' : 'var(--accent)'}`,
              background: danger ? 'var(--red-bg)' : 'var(--accent-glow)',
              color: danger ? 'var(--red)' : 'var(--accent)',
              cursor: 'pointer',
              font: 'inherit',
              fontWeight: 600,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (ctx === null) {
    throw new Error('useToast must be used within an <OverlayProvider>');
  }
  return ctx.toast;
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (ctx === null) {
    throw new Error('useConfirm must be used within an <OverlayProvider>');
  }
  return ctx.confirm;
}
