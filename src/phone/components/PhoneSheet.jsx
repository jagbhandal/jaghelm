import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { ShellPage } from '@ui/app-shell';
import { SheetContext } from '../sheet.js';

/*
 * The frame the web draws the phone screens in (#303, src/shell/PhoneView.jsx):
 * the Android app has its own, MobileApp.jsx.
 */

/** A tab's screen: a page of the shell, the Phone board's 16px gutter, 12px under the header. */
export function PhonePage({ children }) {
  return (
    <ShellPage data-slot="phone-view" className="px-4 pt-3 pb-6">
      {children}
    </ShellPage>
  );
}

/**
 * One detail over the tab, the Phone board's sheet: a full-screen modal
 * dialog (the browser's own, in the top layer over the header and the tabs,
 * the page under it inert), named by the screen's title (`index`, its place
 * on the stack, makes the title's id). Escape asks to close it (`onClose`),
 * as its Back does; the stack closes it.
 */
export function PhoneSheet({ index, onClose, children }) {
  const ref = useRef(null);
  const titleId = `phone-sheet-${index}-title`;
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => {
      if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    };
  }, []);
  const sheet = useMemo(() => ({ titleId }), [titleId]);
  return (
    <dialog
      ref={ref}
      data-slot="phone-sheet"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="m-0 h-dvh max-h-none w-full max-w-none overflow-y-auto overscroll-contain border-0 bg-background p-0 text-text-1"
    >
      <SheetContext.Provider value={sheet}>{children}</SheetContext.Provider>
    </dialog>
  );
}
