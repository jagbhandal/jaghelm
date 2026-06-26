import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusDot from './StatusDot.jsx';

describe('StatusDot', () => {
  it('labels up/down/unknown for screen readers and tints by status', () => {
    const { rerender, container } = render(<StatusDot status="up" />);
    expect(screen.getByText('Up')).toBeInTheDocument();
    expect(container.firstChild).toHaveStyle({ color: 'var(--green)' });
    rerender(<StatusDot status="down" />);
    expect(screen.getByText('Down')).toBeInTheDocument();
    expect(container.firstChild).toHaveStyle({ color: 'var(--red)' });
    rerender(<StatusDot status="unknown" />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(container.firstChild).toHaveStyle({ color: 'var(--amber)' });
  });
});
