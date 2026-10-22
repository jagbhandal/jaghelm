import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { AppHeader, UpdatedAgo, agoText } from '@ui/app-header';
import { UiRoot } from '@ui/root';

// The header's states (incident, healthy, no signal) are tested where the
// shell feeds them, src/shell/ShellHeader.test.jsx; these are its parts.

const banner = () => screen.getByRole('banner');

describe('agoText', () => {
  it('says how long ago, as the header does', () => {
    expect(agoText(0)).toBe('just now');
    expect(agoText(4_999)).toBe('just now');
    expect(agoText(12_000)).toBe('12 s ago');
    expect(agoText(3 * 60_000)).toBe('3 min ago');
    expect(agoText(2 * 3_600_000)).toBe('2 h ago');
    expect(agoText(4 * 86_400_000)).toBe('4 d ago');
    expect(agoText(-1000)).toBe('just now');
  });
});

describe('AppHeader', () => {
  it('is a 48px banner with the brand, a link to the Overview', () => {
    render(<AppHeader name="Homelab" status={{ state: 'ok' }} />);
    expect(banner()).toHaveClass('h-12');
    const home = within(banner()).getByRole('link', { name: 'Homelab' });
    expect(home).toHaveAttribute('href', '/');
  });

  it("shows JagHelm's shield, public/logo.svg, by default (#530)", () => {
    render(<AppHeader name="Homelab" status={{ state: 'ok' }} />);
    const home = within(banner()).getByRole('link', { name: 'Homelab' });
    const logos = home.querySelectorAll('img');
    expect(logos).toHaveLength(1);
    expect(logos[0]).toHaveAttribute('src', '/logo.svg');
    // The name beside it names the link; the shield adds nothing to it.
    expect(logos[0]).toHaveAttribute('alt', '');
    expect(logos[0]).toHaveClass('size-7');
  });

  it("shows a custom logo instead of JagHelm's shield", () => {
    render(<AppHeader name="Homelab" logoUrl="/uploads/logo.png" status={{ state: 'ok' }} />);
    const home = within(banner()).getByRole('link', { name: 'Homelab' });
    const logos = home.querySelectorAll('img');
    expect(logos).toHaveLength(1);
    expect(logos[0]).toHaveAttribute('src', '/uploads/logo.png');
    expect(logos[0]).toHaveAttribute('alt', '');
  });

  it('opens the palette from the search button, saying the shortcut', async () => {
    const user = userEvent.setup();
    const onOpenPalette = vi.fn();
    render(<AppHeader status={{ state: 'ok' }} onOpenPalette={onOpenPalette} shortcut="Ctrl K" />);
    const [wide, icon] = within(banner()).getAllByRole('button', { name: /^Search or jump to/ });
    expect(wide).toHaveTextContent('Ctrl K');
    expect(wide).toHaveAttribute('aria-keyshortcuts', 'Meta+K Control+K');
    await user.click(wide);
    await user.click(icon);
    expect(onOpenPalette).toHaveBeenCalledTimes(2);
  });

  it('links to Settings, marked current there', () => {
    const { rerender } = render(<AppHeader status={{ state: 'ok' }} />);
    const settings = within(banner()).getByRole('link', { name: 'Settings' });
    expect(settings).toHaveAttribute('href', '/settings');
    expect(settings).not.toHaveAttribute('aria-current');
    rerender(<AppHeader status={{ state: 'ok' }} settingsCurrent />);
    expect(settings).toHaveAttribute('aria-current', 'page');
    expect(settings).toHaveClass('bg-accent-tint', 'text-accent-text');
  });

  it('offers Log out only when signing in is asked for', async () => {
    const user = userEvent.setup();
    const onLogout = vi.fn();
    const { rerender } = render(<AppHeader status={{ state: 'ok' }} />);
    expect(within(banner()).queryByRole('button', { name: 'Log out' })).toBeNull();
    rerender(<AppHeader status={{ state: 'ok' }} onLogout={onLogout} />);
    await user.click(within(banner()).getByRole('button', { name: 'Log out' }));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it('offers the theme toggle only when given onThemeChange', () => {
    render(<AppHeader status={{ state: 'ok' }} />);
    expect(within(banner()).queryByRole('button', { name: /^Switch to/ })).toBeNull();
  });

  it('toggles to the other theme: light from dark (a sun), dark from light (a moon)', async () => {
    const user = userEvent.setup();
    const onThemeChange = vi.fn();
    const { unmount } = render(
      <UiRoot>
        <AppHeader status={{ state: 'ok' }} onThemeChange={onThemeChange} />
      </UiRoot>
    );
    const toLight = within(banner()).getByRole('button', { name: 'Switch to light theme' });
    expect(toLight.querySelector('.lucide-sun')).toBeInTheDocument();
    await user.click(toLight);
    expect(onThemeChange).toHaveBeenLastCalledWith('light');
    unmount();

    render(
      <UiRoot theme="light">
        <AppHeader status={{ state: 'ok' }} onThemeChange={onThemeChange} />
      </UiRoot>
    );
    const toDark = within(banner()).getByRole('button', { name: 'Switch to dark theme' });
    expect(toDark.querySelector('.lucide-moon')).toBeInTheDocument();
    await user.click(toDark);
    expect(onThemeChange).toHaveBeenLastCalledWith('dark');
  });

  it('puts the toggle between the search and Settings, as the mock does', () => {
    render(
      <AppHeader status={{ state: 'ok' }} onOpenPalette={() => {}} onThemeChange={() => {}} />
    );
    const order = [
      ...within(banner()).getAllByRole('button', { name: /^Search or jump to/ }),
      within(banner()).getByRole('button', { name: 'Switch to light theme' }),
      within(banner()).getByRole('link', { name: 'Settings' }),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i])).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  });

  it('hands the links to onNavigate', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn((e) => e.preventDefault());
    render(<AppHeader status={{ state: 'crit', sentence: '1 down' }} onNavigate={onNavigate} />);
    await user.click(within(banner()).getByRole('link', { name: /^Critical/ }));
    expect(onNavigate).toHaveBeenLastCalledWith(expect.anything(), '/alerts');
    await user.click(within(banner()).getByRole('link', { name: 'Settings' }));
    expect(onNavigate).toHaveBeenLastCalledWith(expect.anything(), '/settings');
  });
});

describe('UpdatedAgo', () => {
  it('says nothing before the first update', () => {
    const { container } = render(<UpdatedAgo at={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says how long ago the update was', () => {
    render(<UpdatedAgo at={Date.now() - 90_000} />);
    expect(screen.getByText('Updated 1 min ago')).toBeInTheDocument();
  });
});
