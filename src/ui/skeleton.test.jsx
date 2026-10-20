import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Skeleton } from '@ui/skeleton';

describe('Skeleton', () => {
  it('is a still surface-3 block with a 6px radius, hidden from assistive tech', () => {
    const { container } = render(<Skeleton className="h-3 w-[70%]" />);
    const block = container.firstChild;
    expect(block).toHaveAttribute('data-slot', 'skeleton');
    expect(block).toHaveAttribute('aria-hidden', 'true');
    expect(block).toHaveClass('bg-surface-3', 'rounded-md', 'h-3', 'w-[70%]');
    // No shimmer or pulse: §5.3 animates bars only.
    expect(block.className).not.toMatch(/animate-|transition/);
  });

  it('takes the caller’s shape', () => {
    const { container } = render(<Skeleton className="size-7 rounded-full" />);
    expect(container.firstChild).toHaveClass('rounded-full');
    expect(container.firstChild).not.toHaveClass('rounded-md');
  });
});
