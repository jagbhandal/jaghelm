import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { AppBar } from '@ui/app-bar';

describe('AppBar', () => {
  it("shows the app's chip, name and address, and that it stays loaded", () => {
    render(<AppBar name="Uptime Kuma" url="https://kuma.example/dashboard" />);
    const bar = document.querySelector('[data-slot="app-bar"]');
    expect(bar.querySelector('[data-slot="app-chip"]')).toHaveTextContent('UK');
    expect(screen.getByText('Uptime Kuma')).toHaveClass('font-bold');
    expect(screen.getByText('https://kuma.example/dashboard')).toHaveClass('font-mono', 'truncate');
    expect(screen.getByText('Stays loaded when you switch away')).toBeInTheDocument();
  });

  it('Reload calls its handler', async () => {
    const user = userEvent.setup();
    const onReload = vi.fn();
    render(<AppBar name="Netdata" url="https://g.example" onReload={onReload} />);
    await user.click(screen.getByRole('button', { name: 'Reload Netdata' }));
    expect(onReload).toHaveBeenCalledOnce();
  });

  it('"Open in new tab" opens a new browsing context, without access back to JagHelm', () => {
    render(<AppBar name="Netdata" url="https://g.example" href="https://g.example" />);
    const link = screen.getByRole('link', { name: 'Open in new tab' });
    expect(link).toHaveAttribute('href', 'https://g.example');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('has no link without a safe href, and no Reload without a handler', () => {
    render(<AppBar name="Netdata" url="javascript:alert(1)" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
