/*
 * Settings → Nodes & Services → Expiry (#676): the TLS target list visibly
 * adds and removes rows (the display config's `expiry.tls`), a bad target is
 * said and not added, suggestions are one-click and never added alone, the
 * Tailscale state is told, and the two lines are the display config's and
 * change the preview at once.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Expiry from './Expiry.jsx';
import { ConfigProvider } from '../../../context/ConfigContext.jsx';

const mocks = vi.hoisted(() => ({ getExpiry: vi.fn() }));
vi.mock('../../../hooks/useData.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getExpiry: mocks.getExpiry,
}));

function Harness({ initial = {} }) {
  const [config, setConfig] = useState(initial);
  window.__display = config;
  return (
    <ConfigProvider config={config} setConfig={setConfig}>
      <Expiry />
    </ConfigProvider>
  );
}

const answer = (extra = {}) => ({
  configured: false,
  items: [],
  noExpiry: null,
  tailscale: { configured: false },
  suggestions: [],
  ...extra,
});
const mount = async (initial) => {
  const out = render(<Harness initial={initial} />);
  await act(async () => {});
  return out;
};
const amber = () => screen.getByLabelText('Amber under (days left)');
const red = () => screen.getByLabelText('Red under (days left)');
const states = () =>
  [...document.querySelectorAll('[data-slot="expiry-preview"] [data-slot="meter-note"]')].map((n) =>
    n.getAttribute('data-state')
  );

beforeEach(() => {
  mocks.getExpiry.mockReset();
  mocks.getExpiry.mockResolvedValue(answer());
});

describe('TLS targets', () => {
  it('say nothing is tracked on a config that never saved any', async () => {
    await mount();
    expect(screen.getByText(/Nothing tracked yet/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Tracked TLS targets' })).toBeNull();
  });

  it('adding a host shows a row at once, saves it canonical, and clears the box; Enter works too', async () => {
    const user = userEvent.setup();
    await mount();
    await user.type(screen.getByLabelText('Add a host'), 'NAS.Example.com{Enter}');
    const list = screen.getByRole('list', { name: 'Tracked TLS targets' });
    expect(within(list).getByText('nas.example.com')).toBeInTheDocument();
    expect(within(list).getByText('Not checked yet')).toBeInTheDocument();
    expect(window.__display.expiry).toEqual({ tls: ['nas.example.com'] });
    expect(screen.getByLabelText('Add a host')).toHaveValue('');
    await user.type(screen.getByLabelText('Add a host'), '192.168.1.5:8443');
    await user.click(screen.getByRole('button', { name: /Track$/ }));
    expect(window.__display.expiry.tls).toEqual(['nas.example.com', '192.168.1.5:8443']);
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  });

  it('removing a row takes it out; the last one leaves no key behind', async () => {
    const user = userEvent.setup();
    await mount({ expiry: { tls: ['a.example.com', 'b.example.com:8443'] } });
    await user.click(screen.getByRole('button', { name: 'Stop tracking a.example.com' }));
    expect(screen.queryByText('a.example.com')).toBeNull();
    expect(window.__display.expiry).toEqual({ tls: ['b.example.com:8443'] });
    await user.click(screen.getByRole('button', { name: 'Stop tracking b.example.com:8443' }));
    expect(window.__display.expiry).toBeUndefined();
    expect(screen.getByText(/Nothing tracked yet/)).toBeInTheDocument();
  });

  it('a target that is not a host and port is said and not added', async () => {
    const user = userEvent.setup();
    await mount();
    for (const bad of ['https://nas.example.com', 'nas.example.com/path', 'user@nas', 'nas:99999']) {
      await user.clear(screen.getByLabelText('Add a host'));
      await user.type(screen.getByLabelText('Add a host'), `${bad}{Enter}`);
      expect(screen.getByRole('alert')).toHaveTextContent('No https://, path or user name');
      expect(window.__display.expiry).toBeUndefined();
    }
  });

  it('a duplicate and a 31st target are said and not added', async () => {
    const user = userEvent.setup();
    const thirty = Array.from({ length: 30 }, (_, i) => `h${i}.example.com`);
    await mount({ expiry: { tls: thirty } });
    await user.type(screen.getByLabelText('Add a host'), 'H3.example.com{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('already tracked');
    await user.clear(screen.getByLabelText('Add a host'));
    await user.type(screen.getByLabelText('Add a host'), 'new.example.com{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('At most 30 targets');
    expect(window.__display.expiry.tls).toHaveLength(30);
  });

  it('a hand-edited list shows only the entries that parse', async () => {
    await mount({ expiry: { tls: ['ok.example.com', 'https://nope', 7, 'ok.example.com'] } });
    const list = screen.getByRole('list', { name: 'Tracked TLS targets' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
  });

  it("each row shows the server's last result", async () => {
    mocks.getExpiry.mockResolvedValue(
      answer({
        configured: true,
        items: [
          { id: 'tls:a.example.com', source: 'tls', name: 'a.example.com', state: 'ok', daysLeft: 12 },
          { id: 'tls:b.example.com', source: 'tls', name: 'b.example.com', state: 'unreachable', daysLeft: null },
        ],
      })
    );
    await mount({ expiry: { tls: ['a.example.com', 'b.example.com'] } });
    expect(screen.getByText('12 days left')).toBeInTheDocument();
    expect(screen.getByText('Unreachable')).toBeInTheDocument();
  });
});

describe('suggestions', () => {
  it('are one click to track, never tracked alone, and gone once tracked', async () => {
    const user = userEvent.setup();
    mocks.getExpiry.mockResolvedValue(answer({ suggestions: ['git.example.com', 'nas.example.com:8443'] }));
    await mount();
    expect(window.__display.expiry).toBeUndefined();
    await user.click(screen.getByRole('button', { name: 'Track git.example.com' }));
    expect(window.__display.expiry).toEqual({ tls: ['git.example.com'] });
    expect(screen.queryByRole('button', { name: 'Track git.example.com' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Track nas.example.com:8443' })).toBeInTheDocument();
  });
});

describe('Tailscale', () => {
  const words = () => document.querySelector('[data-slot="expiry-tailscale"]').textContent;
  it('says how to set it up when there is no key, and what happened when there is', async () => {
    const { unmount } = await mount();
    expect(words()).toMatch(/Not set up.*JAGHELM_TAILSCALE_API_KEY/);
    unmount();
    mocks.getExpiry.mockResolvedValue(answer({ configured: true, tailscale: { configured: true, state: 'ok' } }));
    const again = await mount();
    expect(words()).toMatch(/key is set/);
    again.unmount();
    mocks.getExpiry.mockResolvedValue(answer({ configured: true, tailscale: { configured: true, state: 'rejected' } }));
    await mount();
    expect(words()).toMatch(/rejected the key.*90 days at most/);
  });
});

describe('Warning lines', () => {
  it('start at 21 and 7 days on a config that has never saved them', async () => {
    await mount();
    expect(amber()).toHaveValue(21);
    expect(red()).toHaveValue(7);
    expect(window.__display.expiryWarnDays).toBeUndefined();
    expect(screen.getByRole('button', { name: /Reset to 21 and 7 days/ })).toBeDisabled();
  });

  it('a valid change is saved at once and the preview follows it', async () => {
    const user = userEvent.setup();
    await mount();
    expect(states()).toEqual(['ok', 'warn', 'crit']);
    await user.clear(amber());
    await user.type(amber(), '60');
    await user.clear(red());
    await user.type(red(), '30');
    expect(window.__display.expiryWarnDays).toBe(60);
    expect(window.__display.expiryCritDays).toBe(30);
    expect(screen.getAllByText('65 days left').length).toBeGreaterThan(0);
    expect(screen.getAllByText('29 days left').length).toBeGreaterThan(0);
    expect(states()).toEqual(['ok', 'warn', 'crit']);
  });

  it('red at or over amber is said on Red and never saved', async () => {
    await mount({ expiryWarnDays: 21, expiryCritDays: 7 });
    fireEvent.change(red(), { target: { value: '30' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Red has to be fewer days than amber');
    expect(red()).toHaveAttribute('aria-invalid', 'true');
    expect(window.__display.expiryCritDays).toBe(7);
  });

  it('not whole days, or out of range, is said and never saved', async () => {
    await mount();
    for (const bad of ['0', '366', '2.5', '']) {
      fireEvent.change(amber(), { target: { value: bad } });
      expect(screen.getByRole('alert')).toHaveTextContent('Whole days, 1 to 365');
    }
    expect(window.__display.expiryWarnDays).toBeUndefined();
  });

  it('reset puts both back to the defaults', async () => {
    const user = userEvent.setup();
    await mount({ expiryWarnDays: 60, expiryCritDays: 30 });
    await user.click(screen.getByRole('button', { name: /Reset to 21 and 7 days/ }));
    expect(window.__display.expiryWarnDays).toBeUndefined();
    expect(window.__display.expiryCritDays).toBeUndefined();
    expect(amber()).toHaveValue(21);
  });
});
