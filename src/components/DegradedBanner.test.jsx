import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import DegradedBanner from './DegradedBanner';

describe('DegradedBanner', () => {
  it('renders nothing when there is neither a message nor a stale note', () => {
    const { container } = render(<DegradedBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('shows an error message (is-error) with a working Retry button', () => {
    const onRetry = vi.fn();
    const { container } = render(
      <DegradedBanner
        message="Live metrics unavailable — Prometheus unreachable"
        onRetry={onRetry}
      />
    );
    // Visual-only: the message text is shown, but the banner is NOT a live region
    // (a single page-level region announces it once — see DashboardView).
    expect(screen.getByText(/Prometheus unreachable/)).toBeInTheDocument();
    expect(container.querySelector('.degraded-banner')).toHaveClass('is-error');
    expect(screen.queryByRole('alert')).toBeNull();

    // Retry's accessible name reflects that it refreshes everything.
    fireEvent.click(screen.getByRole('button', { name: /refresh all data/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows only a stale note (is-stale) with no Retry button', () => {
    const { container } = render(<DegradedBanner staleNote="updated 4m ago" onRetry={() => {}} />);
    expect(screen.getByText('updated 4m ago')).toBeInTheDocument();
    expect(container.querySelector('.degraded-banner')).toHaveClass('is-stale');
    // Retry is reserved for actual errors — a merely-stale panel doesn't offer it.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows both the error message and the stale note together', () => {
    render(
      <DegradedBanner
        message="UPS telemetry unavailable — NUT unreachable"
        staleNote="updated 6m ago"
        onRetry={() => {}}
      />
    );
    expect(screen.getByText(/NUT unreachable/)).toBeInTheDocument();
    expect(screen.getByText('updated 6m ago')).toBeInTheDocument();
  });

  it('omits Retry when no onRetry handler is provided', () => {
    render(<DegradedBanner message="something broke" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
