import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Check } from 'lucide-react';
// The shared component library, through the same alias the web uses.
import { Button } from '@ui/button';
import { StatusLamp } from '@ui/status-lamp';
import { DEFAULT_LOOK } from '@ui/lib/status.js';

// Phase 4 rebuilds the Android screens on src/ui/. This proves the mobile build
// already resolves it: @ui maps to ../src/ui, and resolve.dedupe hands that code
// this app's React. With a second React the Base UI button's hooks would throw.
describe('@ui alias -> shared component library', () => {
  it('renders the shared Button with a Lucide icon', () => {
    render(
      <Button aria-label="Confirm">
        <Check />
      </Button>
    );
    const btn = screen.getByRole('button', { name: 'Confirm' });
    expect(btn).toHaveAttribute('data-slot', 'button');
    expect(btn.querySelector('svg.lucide')).not.toBeNull();
  });

  // The status components moved here from mobile/src/components (#287). Until
  // Phase 4 rebuilds the screens, the Android build (its __ANDROID_LOOK__
  // define) makes them draw the app's own look, which MobileApp.css styles.
  it('draws the shared status components in the Android look by default', () => {
    expect(DEFAULT_LOOK).toBe('android');
    render(<StatusLamp shape="slash" severity="critical" label="DOWN" size={14} />);
    const lamp = screen.getByRole('img', { name: 'DOWN' });
    expect(lamp).toHaveClass('status-lamp', 'lamp--critical');
    expect(lamp).not.toHaveAttribute('data-slot');
  });
});
