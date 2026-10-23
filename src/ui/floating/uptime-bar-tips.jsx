/*
 * The UptimeBar's interactive part (#312), in the floating layer
 * (lib/floating.jsx): ../uptime-bar.jsx draws the strip and mounts this once
 * the layer is in, which a strip asks for the first time a pointer comes over
 * it or it takes focus. It adds nothing to the strip's box: it listens on the
 * strip's element (`rootRef`), marks the active beat with `data-active` (the
 * strip's classes draw its mark), and draws the tooltip in a portal and,
 * for a focusable strip, a polite live region that is `sr-only`.
 *
 *  - The pointer (never a finger): the check under it, its word in bold, its
 *    time to the second and its response time in `text-2` ("Down 14:32:10",
 *    "Up 14:32:40 138 ms"), above the beat, the one under the pointer as
 *    this arrives included. An empty slot has none.
 *  - `focusable` (the drawer's and the phone sheet's strip): focus starts at
 *    the newest check, the arrows, Home and End move, Escape closes, and the
 *    live region says each check the arrows reach ("Down at 14:32:10"), so
 *    the tooltip itself is hidden from assistive tech. A strip focused before
 *    this arrived opens as it does.
 *
 * The tooltip is the Sparkline's readout (sparkline-tip.jsx).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useOverlayPortal } from '../lib/portal.js';
import { SparklineTip } from './sparkline-tip.jsx';

const isCheck = (b) => b !== null && typeof b === 'object';

// Kuma's word for each state a check is drawn in.
const WORDS = {
  ok: 'Up',
  crit: 'Down',
  warn: 'Pending',
  maintenance: 'Maintenance',
  unknown: 'No data',
};

const TIME = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** A check's parts as its tooltip shows them: its word, its time, its response time. */
function checkParts(b) {
  return {
    word: b.word || WORDS[b.state] || WORDS.unknown,
    time: Number.isFinite(b.time) ? TIME.format(new Date(b.time)) : null,
    ping: Number.isFinite(b.ping) && b.ping > 0 ? `${Math.round(b.ping)} ms` : null,
  };
}

/** A check in words, as the live region says it: "Down at 14:32:10", "Up at 14:32:40, 138 ms". */
function checkWords(b) {
  const { word, time, ping } = checkParts(b);
  return [time ? `${word} at ${time}` : word, ping].filter(Boolean).join(', ');
}

const KEYS = {
  ArrowLeft: (i) => Math.max(i - 1, 0),
  ArrowDown: (i) => Math.max(i - 1, 0),
  ArrowRight: (i, last) => Math.min(i + 1, last),
  ArrowUp: (i, last) => Math.min(i + 1, last),
  Home: () => 0,
  End: (i, last) => last,
};

function UptimeBarTips({ rootRef, checks, focusable = false }) {
  const [active, setActive] = useState(null);
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [said, setSaid] = useState('');
  const tip = active == null ? null : checks[active];
  const open = isCheck(tip) && !dismissed && (hovering || focused);
  const [portalRoot, openChange] = useOverlayPortal(rootRef, open, (next) => {
    if (!next) setDismissed(true);
  });

  // What the listeners read, as of the last render.
  const now = useRef(null);
  now.current = { active, hovering, focused, open, checks };

  // The active beat's mark, drawn by the strip's own classes.
  useLayoutEffect(() => {
    const el = open ? rootRef.current?.querySelector(`[data-check="${active}"]`) : null;
    el?.setAttribute('data-active', '');
    return () => el?.removeAttribute('data-active');
  }, [rootRef, open, active]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const move = (i) => {
      setActive(i);
      setDismissed(false);
    };
    const onPointerMove = (e) => {
      if (e.pointerType === 'touch') return;
      const beat = e.target?.closest?.('[data-slot="beat"]');
      if (!beat || !root.contains(beat)) return;
      setHovering(true);
      // An empty slot (padding) has no check, and no tooltip.
      const raw = beat.dataset.check;
      if (raw == null) {
        if (!now.current.focused) setActive(null);
      } else if (Number(raw) !== now.current.active) move(Number(raw));
    };
    const onPointerLeave = () => {
      setHovering(false);
      if (!now.current.focused) setActive(null);
    };
    const onFocus = () => {
      setFocused(true);
      const last = now.current.checks.length - 1;
      if (now.current.active == null && last >= 0) move(last);
    };
    const onBlur = () => {
      setFocused(false);
      setDismissed(false);
      if (!now.current.hovering) setActive(null);
    };
    const onKeyDown = (e) => {
      const { active: at, open: shown, checks: all } = now.current;
      if (e.key === 'Escape') {
        if (shown) {
          e.preventDefault();
          setDismissed(true);
        }
        return;
      }
      const to = KEYS[e.key];
      const last = all.length - 1;
      if (!to || last < 0) return;
      e.preventDefault();
      const next = to(at ?? last, last);
      move(next);
      setSaid(isCheck(all[next]) ? checkWords(all[next]) : '');
    };
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerleave', onPointerLeave);
    if (focusable) {
      root.addEventListener('focus', onFocus);
      root.addEventListener('blur', onBlur);
      root.addEventListener('keydown', onKeyDown);
      // Focused before this arrived (the key that brought focus loaded it).
      if (root.ownerDocument.activeElement === root) onFocus();
    }
    // Pointed at before this arrived (the pointer that loaded it): the check
    // under it, without waiting for the pointer to move again.
    let over = null;
    try {
      over = root.querySelector('[data-check]:hover');
    } catch {
      // A document that can't match :hover: the next move opens it.
    }
    if (over) {
      setHovering(true);
      move(Number(over.dataset.check));
    }
    return () => {
      root.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('pointerleave', onPointerLeave);
      root.removeEventListener('focus', onFocus);
      root.removeEventListener('blur', onBlur);
      root.removeEventListener('keydown', onKeyDown);
    };
  }, [rootRef, focusable]);

  // Above the strip, over the check: the tooltip never covers a beat.
  const anchor = {
    getBoundingClientRect() {
      const el = rootRef.current?.querySelector(`[data-check="${active}"]`);
      const box = el?.getBoundingClientRect() ?? new DOMRect();
      return new DOMRect(box.left + box.width / 2, box.top, 0, 0);
    },
  };
  const parts = isCheck(tip) ? checkParts(tip) : null;

  return (
    <>
      {focusable && (
        <span className="sr-only" aria-live="polite">
          {said}
        </span>
      )}
      <SparklineTip
        open={open}
        onOpenChange={openChange}
        portalRoot={portalRoot}
        anchor={anchor}
        slot="uptime-bar-tooltip"
      >
        {parts && (
          <>
            <span className="font-bold">{parts.word}</span>
            {parts.time && <span className="text-text-2">{parts.time}</span>}
            {parts.ping && <span className="text-text-2">{parts.ping}</span>}
          </>
        )}
      </SparklineTip>
    </>
  );
}

export { UptimeBarTips };
