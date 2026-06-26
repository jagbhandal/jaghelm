import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusBanner from './StatusBanner.jsx';

describe('StatusBanner', () => {
  it('shows Loading… when loading and no data yet', () => {
    render(<StatusBanner loading={true} error={null} hasData={false} />);
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does NOT show loading when data is already present', () => {
    render(<StatusBanner loading={true} error={null} hasData={true} />);
    expect(screen.queryByText(/Loading/i)).toBeNull();
  });

  it('shows error banner without "last known data" when no prior data', () => {
    render(<StatusBanner loading={false} error={new Error('fail')} hasData={false} />);
    const banner = screen.getByRole('alert');
    expect(banner.textContent).toBe("Couldn't reach JagHelm");
    expect(banner.textContent).not.toMatch(/last known/i);
  });

  it('shows error banner with "last known data" when prior data exists', () => {
    render(<StatusBanner loading={false} error={new Error('fail')} hasData={true} />);
    const banner = screen.getByRole('alert');
    expect(banner.textContent).toMatch(/last known/i);
  });

  it('renders nothing when no error and not loading', () => {
    const { container } = render(<StatusBanner loading={false} error={null} hasData={true} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when loading is done and no error', () => {
    const { container } = render(<StatusBanner loading={false} error={null} hasData={false} />);
    expect(container.firstChild).toBeNull();
  });
});
