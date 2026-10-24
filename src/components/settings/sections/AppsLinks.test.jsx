import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import AppsLinks from './AppsLinks.jsx';
import { ConfigProvider } from '../../../context/ConfigContext.jsx';
import { OverlayProvider } from '../../../context/OverlayContext.jsx';
import { appsOf, navGroups, paletteAppsOf } from '../../../shell/nav.js';

// Settings → Apps & links (#317, #362): the embedded apps with an embedding
// check before one is added, Quick Launch links, where links open and the
// Launch page's web search.
function Harness({ initial, checkEmbed, onCommit }) {
  const [config, setConfigState] = useState(initial);
  window.__config = config;
  const setConfig = (updater) =>
    setConfigState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      onCommit?.({ prev, next });
      return next;
    });
  return (
    <OverlayProvider>
      <ConfigProvider config={config} setConfig={setConfig}>
        <AppsLinks checkEmbed={checkEmbed} />
      </ConfigProvider>
    </OverlayProvider>
  );
}

const GRAFANA = { id: 'grafana', label: 'Grafana', type: 'iframe', url: 'https://grafana.example' };
const KUMA = { id: 'kuma', label: 'Uptime Kuma', type: 'iframe', url: 'https://kuma.example' };
const VAULT = { id: 'vault', label: 'Vaultwarden', type: 'iframe', url: 'https://vault.example' };
const CONFIG = {
  title: 'JAGHELM',
  tabs: [GRAFANA, KUMA, VAULT],
  links: { tools: [{ name: 'Gitea', icon: '🔗', url: 'https://git.example' }] },
};

const allowed = () => vi.fn(async () => ({ verdict: 'allowed' }));
const blocked = () => vi.fn(async () => ({ verdict: 'blocked', header: 'X-Frame-Options: DENY' }));
const names = () => window.__config.tabs.map((t) => t.label);

afterEach(() => {
  delete window.__config;
});

const apps = () => screen.getByRole('list', { name: 'Embedded apps' });
const openAddApp = async (user) => user.click(screen.getByRole('button', { name: 'Add app' }));
async function fillApp(user, { name, url }) {
  await user.type(screen.getByRole('textbox', { name: 'Name' }), name);
  await user.type(screen.getByRole('textbox', { name: 'URL' }), url);
}

describe('Settings → Apps & links: what carries over', () => {
  it('lists every saved app with its address, and every Quick Launch link', async () => {
    render(<Harness initial={CONFIG} checkEmbed={allowed()} />);
    const rows = within(apps()).getAllByRole('listitem');
    expect(
      rows.map((r) => within(r).getByText(/^(Grafana|Uptime Kuma|Vaultwarden)$/).textContent)
    ).toEqual(['Grafana', 'Uptime Kuma', 'Vaultwarden']);
    expect(rows[0]).toHaveTextContent('grafana.example');
    expect(screen.getByRole('region', { name: 'Tools' })).toHaveTextContent('Gitea');
    expect(await screen.findAllByText('Embeds fine')).toHaveLength(3);
  });

  it('keeps tabs and links as saved: changing one app rewrites only that app', async () => {
    const user = userEvent.setup();
    const old = {
      ...CONFIG,
      tabs: [{ ...GRAFANA, extra: 'kept' }, { id: 'dash', label: 'Dash', type: 'dashboard' }, KUMA],
    };
    render(<Harness initial={old} checkEmbed={allowed()} />);
    await user.click(screen.getByRole('button', { name: 'Edit Grafana' }));
    const name = screen.getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'Grafana 2');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(window.__config.tabs).toEqual([
      { ...GRAFANA, label: 'Grafana 2', extra: 'kept' },
      { id: 'dash', label: 'Dash', type: 'dashboard' },
      KUMA,
    ]);
    expect(window.__config.links).toBe(old.links);
  });

  it('says where links open, New tab by default, and keeps the setting', async () => {
    const user = userEvent.setup();
    render(<Harness initial={CONFIG} checkEmbed={allowed()} />);
    const group = screen.getByRole('radiogroup', { name: 'Open links in' });
    expect(within(group).getByRole('radio', { name: 'New tab' })).toBeChecked();
    await user.click(within(group).getByRole('radio', { name: 'Same tab' }));
    expect(window.__config.linkTarget).toBe('_self');
  });

  // #307: the web search is on the Launch page, so its switch says so.
  it('has the Launch page’s web search: its switch, on by default, and its engine', async () => {
    const user = userEvent.setup();
    render(<Harness initial={CONFIG} checkEmbed={allowed()} />);
    const toggle = screen.getByRole('switch', { name: 'Show the web search on the Launch page' });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(window.__config.showSearch).toBe(false);
    await user.click(screen.getByRole('combobox', { name: 'Search engine' }));
    await user.click(await screen.findByRole('option', { name: 'DuckDuckGo' }));
    expect(window.__config.searchEngine).toBe('duckduckgo');
  });
});

describe('Settings → Apps & links: adding an app', () => {
  it('reports a site that blocks embedding before saving, and offers a new tab', async () => {
    const user = userEvent.setup();
    const check = blocked();
    render(<Harness initial={CONFIG} checkEmbed={check} />);
    await openAddApp(user);
    await fillApp(user, { name: 'Paperless', url: 'paperless.lan' });
    await user.click(screen.getByRole('button', { name: 'Check embedding and add' }));

    // The check ran for the address as it would be saved; nothing is saved yet.
    expect(check).toHaveBeenCalledWith('https://paperless.lan');
    expect(await screen.findByText('Paperless won’t show inside JagHelm')).toBeInTheDocument();
    expect(screen.getByText(/Its server tells browsers.*X-Frame-Options: DENY/)).toBeInTheDocument();
    expect(names()).toEqual(['Grafana', 'Uptime Kuma', 'Vaultwarden']);

    await user.click(screen.getByRole('button', { name: 'Open in a new tab instead' }));
    expect(window.__config.tabs.at(-1)).toMatchObject({
      id: 'paperless',
      label: 'Paperless',
      type: 'iframe',
      url: 'https://paperless.lan',
      newTab: true,
    });
    expect(screen.getByText('Opens in a new tab')).toBeInTheDocument();
  });

  it('can add a blocking app inside JagHelm anyway, or go back to edit', async () => {
    const user = userEvent.setup();
    render(<Harness initial={CONFIG} checkEmbed={blocked()} />);
    await openAddApp(user);
    await fillApp(user, { name: 'Paperless', url: 'https://paperless.lan' });
    await user.click(screen.getByRole('button', { name: 'Check embedding and add' }));
    await user.click(await screen.findByRole('button', { name: 'Back to edit' }));
    expect(names()).toHaveLength(3);
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Paperless');
    await user.click(screen.getByRole('button', { name: 'Check embedding and add' }));
    await user.click(await screen.findByRole('button', { name: 'Add it inside JagHelm anyway' }));
    const added = window.__config.tabs.at(-1);
    expect(added).toMatchObject({ label: 'Paperless', url: 'https://paperless.lan' });
    expect(added.newTab).toBeUndefined();
  });

  it('adds an app that embeds at once, with its name, address and icon, as a tab', async () => {
    const user = userEvent.setup();
    render(<Harness initial={CONFIG} checkEmbed={allowed()} />);
    await openAddApp(user);
    await fillApp(user, { name: 'Home Assistant', url: 'ha.lan:8123' });
    await user.click(screen.getByRole('button', { name: 'Check embedding and add' }));
    await waitFor(() => expect(names()).toContain('Home Assistant'));
    expect(window.__config.tabs.at(-1)).toEqual({
      id: 'home-assistant',
      label: 'Home Assistant',
      type: 'iframe',
      url: 'https://ha.lan:8123',
    });
  });

  it('says when it could not read the app, and leaves the choice', async () => {
    const user = userEvent.setup();
    const check = vi.fn(async () => ({ verdict: 'unknown', reason: 'timed out' }));
    render(<Harness initial={CONFIG} checkEmbed={check} />);
    await openAddApp(user);
    await fillApp(user, { name: 'Slow', url: 'https://slow.lan' });
    await user.click(screen.getByRole('button', { name: 'Check embedding and add' }));
    expect(await screen.findByText('JagHelm couldn’t check Slow')).toBeInTheDocument();
    expect(screen.getByText(/couldn’t read its headers \(timed out\)/)).toBeInTheDocument();
    expect(names()).toHaveLength(3);
  });

  it('opens an app in a new browser tab without checking it', async () => {
    const user = userEvent.setup();
    const check = allowed();
    render(<Harness initial={{ ...CONFIG, tabs: [] }} checkEmbed={check} />);
    await openAddApp(user);
    await fillApp(user, { name: 'Router', url: 'http://192.168.1.1' });
    await user.click(
      screen.getByRole('switch', { name: 'Open in a new browser tab instead of inside JagHelm' })
    );
    await user.click(screen.getByRole('button', { name: 'Add app', description: '' }));
    expect(window.__config.tabs).toEqual([
      { id: 'router', label: 'Router', type: 'iframe', url: 'http://192.168.1.1', newTab: true },
    ]);
    expect(check).not.toHaveBeenCalledWith('http://192.168.1.1');
  });

  it('asks for a name and a usable address, and saves nothing until it has them', async () => {
    const user = userEvent.setup();
    const check = allowed();
    render(<Harness initial={CONFIG} checkEmbed={check} />);
    await openAddApp(user);
    await user.click(screen.getByRole('button', { name: 'Check embedding and add' }));
    expect(screen.getByText('Give the app a name.')).toBeInTheDocument();
    expect(screen.getByText(/Enter the address/)).toBeInTheDocument();
    await fillApp(user, { name: 'Bad', url: 'ftp://files.lan' });
    await user.click(screen.getByRole('button', { name: 'Check embedding and add' }));
    expect(await screen.findByText('Use an http:// or https:// address.')).toBeInTheDocument();
    expect(names()).toHaveLength(3);
  });

  it('numbers an id another app already has', async () => {
    const user = userEvent.setup();
    render(<Harness initial={CONFIG} checkEmbed={allowed()} />);
    await openAddApp(user);
    await fillApp(user, { name: 'Grafana', url: 'https://g2.lan' });
    await user.click(screen.getByRole('button', { name: 'Check embedding and add' }));
    await waitFor(() => expect(window.__config.tabs).toHaveLength(4));
    expect(window.__config.tabs.at(-1).id).toBe('grafana-2');
  });
});

describe('Settings → Apps & links: the apps in the list', () => {
  it('shows each app’s embedding check in words', async () => {
    const check = vi.fn(async (url) =>
      url.includes('vault')
        ? { verdict: 'blocked', header: 'X-Frame-Options: DENY' }
        : url.includes('kuma')
          ? { verdict: 'unknown', reason: 'timed out' }
          : { verdict: 'allowed' }
    );
    render(
      <Harness
        initial={{
          ...CONFIG,
          tabs: [
            ...CONFIG.tabs,
            { ...VAULT, id: 'v2', label: 'Router', newTab: true, url: 'https://r.lan' },
          ],
        }}
        checkEmbed={check}
      />
    );
    const rows = within(apps()).getAllByRole('listitem');
    expect(await within(rows[0]).findByText('Embeds fine')).toBeInTheDocument();
    expect(await within(rows[1]).findByText('Could not check (timed out)')).toBeInTheDocument();
    expect(
      await within(rows[2]).findByText('Blocks embedding (X-Frame-Options: DENY)')
    ).toBeInTheDocument();
    expect(within(rows[3]).getByText('Opens in a new tab')).toBeInTheDocument();
    // A new-tab app is not checked.
    expect(check).not.toHaveBeenCalledWith('https://r.lan');
  });

  it('reorders with the Move buttons, and the sidebar follows the new order', async () => {
    const user = userEvent.setup();
    render(<Harness initial={CONFIG} checkEmbed={allowed()} />);
    expect(screen.getByRole('button', { name: 'Move Grafana up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Vaultwarden down' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Move Vaultwarden up' }));
    expect(names()).toEqual(['Grafana', 'Vaultwarden', 'Uptime Kuma']);
    expect(screen.getByText('Moved Vaultwarden to position 2 of 3.')).toBeInTheDocument();

    const side = navGroups({
      routeId: 'overview',
      apps: appsOf(window.__config.tabs),
      loaded: new Set(),
      onUnload() {},
      badge: null,
    })
      .find((g) => g.id === 'apps')
      .items.filter((i) => i.id.startsWith('app:'))
      .map((i) => i.label);
    expect(side).toEqual(['Grafana', 'Vaultwarden', 'Uptime Kuma']);
  });

  it('reorders by dragging a row onto another', () => {
    render(<Harness initial={CONFIG} checkEmbed={allowed()} />);
    const rows = within(apps()).getAllByRole('listitem');
    const dataTransfer = { setData() {}, effectAllowed: '' };
    fireEvent.dragStart(rows[2].querySelector('[draggable]'), { dataTransfer });
    fireEvent.dragOver(rows[0], { dataTransfer });
    fireEvent.drop(rows[0], { dataTransfer });
    expect(names()).toEqual(['Vaultwarden', 'Grafana', 'Uptime Kuma']);
  });

  it('keeps tabs that are not apps in their places when the apps are reordered', async () => {
    const user = userEvent.setup();
    const dash = { id: 'dash', label: 'Dash', type: 'dashboard' };
    render(<Harness initial={{ ...CONFIG, tabs: [GRAFANA, dash, KUMA] }} checkEmbed={allowed()} />);
    await user.click(screen.getByRole('button', { name: 'Move Uptime Kuma up' }));
    expect(window.__config.tabs.map((t) => t.id)).toEqual(['kuma', 'dash', 'grafana']);
  });

  it('removes an app after a dialog that names it, and it leaves the sidebar and the palette', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm');
    render(<Harness initial={CONFIG} checkEmbed={allowed()} />);
    await user.click(screen.getByRole('button', { name: 'Remove Uptime Kuma' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Remove Uptime Kuma?');
    // Cancel: still there.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(names()).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'Remove Uptime Kuma' }));
    await user.click(await screen.findByRole('button', { name: 'Remove app' }));
    await waitFor(() => expect(names()).toEqual(['Grafana', 'Vaultwarden']));
    expect(paletteAppsOf(appsOf(window.__config.tabs)).map((a) => a.label)).toEqual([
      'Grafana',
      'Vaultwarden',
    ]);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('edits an app’s name, address and new-tab choice, and says so when it blocks', async () => {
    const user = userEvent.setup();
    render(<Harness initial={CONFIG} checkEmbed={blocked()} />);
    await screen.findAllByText(/Blocks embedding/);
    await user.click(screen.getByRole('button', { name: 'Edit Vaultwarden' }));
    expect(screen.getByText(/This app blocks embedding/)).toBeInTheDocument();
    await user.click(
      screen.getByRole('switch', { name: 'Open in a new browser tab instead of inside JagHelm' })
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(window.__config.tabs[2]).toMatchObject({ id: 'vault', newTab: true });
  });
});

describe('Settings → Apps & links: Quick Launch links', () => {
  it('lists every group: an empty one, a group saved as something else, a dotted name', () => {
    render(
      <Harness
        initial={{
          ...CONFIG,
          links: {
            personal: [],
            broken: null,
            'my.group': [{ name: 'Dotted', url: 'https://d.example' }],
            odd: [null, { icon: '🔗' }, { name: 'No address' }],
          },
        }}
        checkEmbed={allowed()}
      />
    );
    for (const title of ['Personal', 'Broken', 'My.group', 'Odd']) {
      expect(screen.getByRole('region', { name: title })).toBeInTheDocument();
    }
    expect(screen.getByRole('region', { name: 'My.group' })).toHaveTextContent('Dotted');
    expect(screen.getByRole('region', { name: 'Odd' })).toHaveTextContent('3 links');
    expect(screen.getByRole('region', { name: 'Personal' })).toHaveTextContent('0 links');
  });

  it('adds a link to a group, with https:// added, leaving the old config untouched', async () => {
    const user = userEvent.setup();
    let commit;
    render(<Harness initial={CONFIG} checkEmbed={allowed()} onCommit={(c) => (commit = c)} />);
    await user.click(screen.getByRole('button', { name: 'Add a link to Tools' }));
    const form = screen.getByRole('button', { name: 'Add link' }).closest('form');
    await user.type(within(form).getByRole('textbox', { name: 'Name' }), 'Grafana');
    await user.type(within(form).getByRole('textbox', { name: 'URL' }), 'grafana.example.com');
    await user.click(within(form).getByRole('button', { name: 'Add link' }));
    expect(commit.next.links.tools).toHaveLength(2);
    expect(commit.next.links.tools[1]).toMatchObject({
      name: 'Grafana',
      url: 'https://grafana.example.com',
    });
    expect(commit.prev.links.tools).toHaveLength(1);
    expect(commit.prev.links.tools).not.toBe(commit.next.links.tools);
  });

  it('edits a link in a group whose name has a dot', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={{
          ...CONFIG,
          links: { 'my.group': [{ name: 'Dotted', url: 'https://d.example' }] },
        }}
        checkEmbed={allowed()}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Edit Dotted' }));
    const name = screen.getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'Dots');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(window.__config.links['my.group'][0].name).toBe('Dots');
    expect(Object.keys(window.__config.links)).toEqual(['my.group']);
  });

  it('reorders and removes links', async () => {
    const user = userEvent.setup();
    const links = {
      tools: [
        { name: 'Email', url: 'https://a.example' },
        { name: 'Docs', url: 'https://b.example' },
      ],
    };
    render(<Harness initial={{ ...CONFIG, links }} checkEmbed={allowed()} />);
    await user.click(screen.getByRole('button', { name: 'Move Docs up' }));
    expect(window.__config.links.tools.map((l) => l.name)).toEqual(['Docs', 'Email']);
    await user.click(screen.getByRole('button', { name: 'Remove Docs' }));
    expect(window.__config.links.tools.map((l) => l.name)).toEqual(['Email']);
  });

  it('adds a group under a lower-case key, and refuses one that exists', async () => {
    const user = userEvent.setup();
    render(<Harness initial={CONFIG} checkEmbed={allowed()} />);
    await user.click(screen.getByRole('button', { name: 'Add group' }));
    await user.type(screen.getByRole('textbox', { name: 'Group name' }), 'Home Lab');
    await user.click(screen.getByRole('button', { name: 'Create group' }));
    expect(window.__config.links.home_lab).toEqual([]);
    expect(screen.getByRole('region', { name: 'Home Lab' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add group' }));
    await user.type(screen.getByRole('textbox', { name: 'Group name' }), 'tools');
    await user.click(screen.getByRole('button', { name: 'Create group' }));
    expect(screen.getByText('There is already a group called Tools.')).toBeInTheDocument();
  });

  it('removes a group after a dialog that names it; the first three groups stay', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={{
          ...CONFIG,
          links: { personal: [], tools: [{ name: 'Gitea', url: 'https://g.example' }] },
        }}
        checkEmbed={allowed()}
      />
    );
    expect(screen.queryByRole('button', { name: 'Remove the Personal group' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Remove the Tools group' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Remove the Tools group?');
    await user.click(within(dialog).getByRole('button', { name: 'Remove group' }));
    await waitFor(() => expect(window.__config.links).toEqual({ personal: [] }));
  });
});
