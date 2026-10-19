import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Check } from 'lucide-react';
// Through the alias, as app code will import it (components.json, vite.config.js).
import { Button } from '@ui/button';
import { cn } from '@ui/lib/utils';

// The one component in src/ui/ for now: it proves the shadcn/ui pipeline end to
// end (generated as JSX into src/ui/, resolved through @ui). No screen uses it yet.
describe('src/ui Button (shadcn/ui pipeline)', () => {
  it('renders a native button with its Tailwind classes', () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn).toHaveAttribute('data-slot', 'button');
    expect(btn).toHaveClass('inline-flex', 'bg-primary', 'h-8', 'px-2.5');
  });

  it("lets the caller's className override the component's own utilities", () => {
    render(<Button className="px-6">Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn).toHaveClass('px-6');
    expect(btn).not.toHaveClass('px-2.5');
  });

  it('renders a Lucide icon inside it', () => {
    render(
      <Button variant="outline" size="icon" aria-label="Confirm">
        <Check />
      </Button>
    );
    const btn = screen.getByRole('button', { name: 'Confirm' });
    expect(btn.querySelector('svg.lucide')).not.toBeNull();
    expect(btn).toHaveClass('size-8', 'border-border');
  });

  it('cn merges conditional classes and resolves conflicts', () => {
    const disabled = false;
    expect(cn('p-2', disabled && 'opacity-50', { 'text-sm': true }, 'p-4')).toBe('text-sm p-4');
  });
});
