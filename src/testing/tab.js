// Tab (or Shift+Tab, with { shift: true }) in a test, then wait for a focus
// trap to move focus off its guard: Base UI's modal popups (src/ui/ dialogs,
// drawers, confirms) put a focusable guard at each end, which passes focus to
// the other end in the next frame.
import { waitFor } from '@testing-library/react';
import { expect } from 'vitest';

export async function tab(user, options) {
  await user.tab(options);
  await waitFor(() =>
    expect(document.activeElement).not.toHaveAttribute('data-base-ui-focus-guard')
  );
}
