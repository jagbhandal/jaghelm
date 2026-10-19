import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Check } from 'lucide-react';
// The shared component library, through the same alias the web uses.
import { Button } from '@ui/button';

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
});
