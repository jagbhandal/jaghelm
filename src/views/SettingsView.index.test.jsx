/*
 * Settings' index, search and addresses (#317, spec §7): /settings is a card
 * per section, searchable by what each holds; /settings/<section> opens one;
 * an old tab's address goes to the section its settings moved to; and every
 * control the 13 tabs had is in a section.
 */
import { render, screen, within, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsView from './SettingsView';
import { ConfigProvider } from '../context/ConfigContext.jsx';
import { OverlayProvider } from '../context/OverlayContext.jsx';
import {
  MOVED_ANCHORS,
  MOVED_SECTIONS,
  SETTINGS_SECTIONS,
} from '../components/settings/sections.js';

const SERVER_CONFIG = {
  nodes: { pi1: { display_name: 'Gateway', visible: true } },
  services: {},
  integrations: {},
};
const LIVE = {
  nodes: {
    pi1: {
      display_name: 'Gateway',
      services: [{ uid: 'pi1:adguard', container: 'adguard', display_name: 'AdGuard' }],
    },
  },
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      if (url === '/api/services/config') return Response.json(SERVER_CONFIG);
      if (url === '/api/services') return Response.json(LIVE);
      if (url === '/api/services/monitors') return Response.json([]);
      if (url === '/api/integrations/presets') return Response.json([]);
      return Response.json({});
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

const CONFIG = {
  title: 'JAGHELM',
  tabs: [{ id: 'netdata', label: 'Netdata', type: 'iframe', url: 'https://netdata.example' }],
  links: { tools: [{ name: 'Gitea', icon: '🔗', url: 'https://git.example' }] },
  sections: {},
};

/** Settings as App draws it; `onSectionChange` makes it routed (App.jsx). */
function Harness({ section, onSectionChange }) {
  const [config, setConfig] = useState(CONFIG);
  return (
    <OverlayProvider>
      <ConfigProvider config={config} setConfig={setConfig}>
        <SettingsView
          theme="dark"
          setTheme={vi.fn()}
          section={section}
          onSectionChange={onSectionChange}
        />
      </ConfigProvider>
    </OverlayProvider>
  );
}

const h1 = () => screen.getByRole('heading', { level: 1 });
/** Each card's section, by its address (a card found by a setting adds its part's #anchor). */
const cards = () =>
  within(screen.getByRole('list'))
    .queryAllByRole('link')
    .map((a) => a.getAttribute('href').split('#')[0]);
const search = () => screen.getByRole('searchbox', { name: 'Search settings' });

describe('the index (/settings)', () => {
  it('is a card per section, in the list’s order, each a link to its address', () => {
    render(<Harness />);
    expect(h1()).toHaveTextContent('Settings');
    expect(SETTINGS_SECTIONS.map((s) => s.label)).toEqual([
      'Sources',
      'Nodes & Services',
      'Integrations',
      'Apps & links',
      'Notifications',
      'Appearance',
      'System',
    ]);
    expect(cards()).toEqual(SETTINGS_SECTIONS.map((s) => `/settings/${s.id}`));
    for (const s of SETTINGS_SECTIONS) {
      const card = screen.getByRole('link', { name: s.label });
      expect(card).toHaveAccessibleDescription(s.desc);
    }
  });

  it('draws each section’s lucide icon, and no emoji anywhere', () => {
    render(<Harness />);
    for (const s of SETTINGS_SECTIONS) {
      const card = screen.getByRole('link', { name: s.label });
      expect(card.querySelector('svg.lucide')).not.toBeNull();
    }
    expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('says every change applies at once: there is no preview (M10)', () => {
    render(<Harness />);
    expect(screen.getByText(/There is no separate preview/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /preview/i })).toBeNull();
    expect(screen.queryByText('LIVE PREVIEW')).toBeNull();
  });
});

describe('the search finds a section by what it holds', () => {
  // Words in no section's name or line, each in one section's settings.
  const BY_CONTENTS = [
    ['font', 'Appearance', 'Font family'],
    ['dark', 'Appearance', 'Theme'],
    ['celsius', 'Appearance', 'Units'],
    ['logo', 'Appearance', 'Logo'],
    ['latitude', 'Appearance', 'Weather'],
    ['password', 'System', 'Password and sessions'],
    ['export', 'System', 'Backup'],
    ['interval', 'System', 'Data refresh'],
    ['kuma', 'Nodes & Services', 'Services'],
    ['prometheus', 'Nodes & Services', 'Nodes'],
    ['iframe', 'Apps & links', 'Embedded apps'],
    ['bookmarks', 'Apps & links', 'Quick Launch links'],
    ['same tab', 'Apps & links', 'Where links open'],
    ['duckduckgo', 'Apps & links', 'Web search'],
    ['api key', 'Integrations', 'Connected'],
    ['gallery', 'Integrations', 'Add an integration'],
    ['critical', 'Notifications', 'Thresholds'],
    ['recoveries', 'Notifications', 'What pages the phones'],
    ['test push', 'Notifications', 'Devices'],
  ];

  it.each(BY_CONTENTS)('“%s” finds %s, by its %s', async (words, label, setting) => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(search(), words);
    const card = screen.getByRole('link', { name: label });
    expect(within(card).getByText(`Matches: ${setting}`)).toBeInTheDocument();
    expect(cards()).toContain(`/settings/${SETTINGS_SECTIONS.find((s) => s.label === label).id}`);
  });

  // #318: a source's name finds Sources, at its row; Nodes & Services keeps
  // "kuma" and "prometheus" too (its monitors, its nodes' labels).
  it.each([
    ['prometheus', 'Prometheus', 'prometheus'],
    ['kuma', 'Uptime Kuma', 'kuma'],
    ['ups', 'NUT (UPS)', 'nut'],
    ['gitea', 'Gitea', 'gitea'],
    ['cron', 'Cron reporters', 'cron-reporters'],
  ])('“%s” finds Sources, by its %s, at #%s', async (words, setting, anchor) => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(search(), words);
    const card = screen.getByRole('link', { name: 'Sources' });
    expect(within(card).getByText(`Matches: ${setting}`)).toBeInTheDocument();
    expect(card).toHaveAttribute('href', `/settings/sources#${anchor}`);
  });

  // An integration has a password too: both sections hold one.
  it('“password” finds System and Integrations, and nothing else', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(search(), 'password');
    expect(cards()).toEqual(['/settings/integrations', '/settings/system']);
  });

  // One test per section, each name pasted whole: the section's own settings
  // are what must find it, and a section added later brings its own test.
  it.each(SETTINGS_SECTIONS.map((s) => [s.label, s]))(
    'every setting %s declares finds it, named on its card',
    async (_label, s) => {
      const user = userEvent.setup();
      render(<Harness />);
      await user.click(search());
      for (const { name } of s.settings) {
        await user.clear(search());
        await user.paste(name);
        const card = screen.getByRole('link', { name: s.label });
        expect(card, `${name} → ${s.label}`).toHaveAccessibleDescription(
          expect.stringContaining(name)
        );
      }
    }
  );

  it('finds a section by its name too, and says when nothing matches', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(search(), 'links');
    expect(cards()).toEqual(['/settings/apps']);
    await user.clear(search());
    await user.type(search(), 'zzz');
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('No setting matches “zzz”.');
    await user.clear(search());
    expect(cards()).toHaveLength(SETTINGS_SECTIONS.length);
  });

  it('keeps its words when a section is opened and the index shown again', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(search(), 'font');
    await user.click(screen.getByRole('link', { name: 'Appearance' }));
    expect(h1()).toHaveTextContent('Appearance');
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    expect(search()).toHaveValue('font');
  });
});

describe('a section’s page (/settings/<section>)', () => {
  it('heads it with its name and line, a link back to the index, and the sections beside it', async () => {
    const user = userEvent.setup();
    render(<Harness section="system" />);
    expect(h1()).toHaveTextContent('System');
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/settings'
    );
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.getAttribute('href'))
    ).toEqual(SETTINGS_SECTIONS.map((s) => `/settings/${s.id}`));
    expect(within(nav).getByRole('link', { name: 'System' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    await user.click(within(nav).getByRole('link', { name: 'Apps & links' }));
    expect(h1()).toHaveTextContent('Apps & links');
  });

  it.each(SETTINGS_SECTIONS.map((s) => [s.label, s.id]))(
    '%s: every part its search names heads its page, under its anchor',
    async (_label, id) => {
      render(<Harness section={id} />);
      for (const { name, anchor } of SETTINGS_SECTIONS.find((s) => s.id === id).settings) {
        const heading = await screen.findByRole('heading', { name });
        expect(heading, name).toBeInTheDocument();
        if (anchor == null) continue;
        const part = document.getElementById(anchor);
        expect(part, `#${anchor}`).not.toBeNull();
        expect(part).toContainElement(heading);
      }
    }
  );
});

// #317 review: each old tab's name finds the section that holds what it had.
describe('an old tab’s name finds its section', () => {
  const TABS = [
    'general',
    'appearance',
    'typography',
    'layout',
    'sections',
    'nodes',
    'services',
    'integrations',
    'links',
    'widgets',
    'tabs',
    'security',
    'backup',
  ];
  it.each(TABS)('“%s”', async (tab) => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(search(), tab);
    expect(cards()).toContainEqual(
      expect.stringContaining(`/settings/${MOVED_SECTIONS[tab] ?? tab}`)
    );
  });
});

describe('opening a section at its part', () => {
  let scrolled;
  beforeEach(() => {
    scrolled = [];
    Element.prototype.scrollIntoView = function scrollIntoView() {
      scrolled.push(this.id);
    };
  });
  afterEach(() => {
    delete Element.prototype.scrollIntoView;
  });

  it('a card found by a setting links to its part, and opens the section there', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(search(), 'clock');
    const card = screen.getByRole('link', { name: 'Appearance' });
    expect(card).toHaveAttribute('href', '/settings/appearance#clock');
    await user.click(card);
    expect(h1()).toHaveTextContent('Appearance');
    expect(scrolled).toEqual(['clock']);
  });

  it('a card found by its name alone opens the section at the top', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(search(), 'system');
    expect(screen.getByRole('link', { name: 'System' })).toHaveAttribute(
      'href',
      '/settings/system'
    );
  });

  it.each([
    ['sections', 'nodes', 'custom-groups'],
    ['widgets', 'appearance', 'weather'],
    ['security', 'system', 'password'],
  ])('/settings/%s opens %s at #%s, and the address says so', (old, now, anchor) => {
    window.history.replaceState(null, '', `/settings/${old}`);
    const onSectionChange = vi.fn((id) => window.history.replaceState(null, '', `/settings/${id}`));
    render(<Harness section={old} onSectionChange={onSectionChange} />);
    expect(onSectionChange).toHaveBeenCalledWith(now);
    expect(MOVED_ANCHORS[old]).toBe(anchor);
    expect(window.location.pathname + window.location.hash).toBe(`/settings/${now}#${anchor}`);
    expect(scrolled).toEqual([anchor]);
    window.history.replaceState(null, '', '/');
  });
});

describe('addresses', () => {
  it.each(Object.entries(MOVED_SECTIONS))(
    'an old tab’s address, /settings/%s, opens %s and becomes its address',
    (old, now) => {
      const onSectionChange = vi.fn();
      render(<Harness section={old} onSectionChange={onSectionChange} />);
      expect(onSectionChange).toHaveBeenCalledWith(now);
      expect(h1()).toHaveTextContent(SETTINGS_SECTIONS.find((s) => s.id === now).label);
    }
  );

  it('a section’s own address stays; one no section has becomes the index’s', () => {
    const onSectionChange = vi.fn();
    for (const s of SETTINGS_SECTIONS) {
      render(<Harness section={s.id} onSectionChange={onSectionChange} />);
      cleanup();
    }
    render(<Harness onSectionChange={onSectionChange} />);
    expect(onSectionChange).not.toHaveBeenCalled();
    cleanup();
    render(<Harness section="nope" onSectionChange={onSectionChange} />);
    expect(onSectionChange).toHaveBeenCalledWith(undefined);
    expect(h1()).toHaveTextContent('Settings');
  });
});

/*
 * Every control the 13 tabs had before #317, found in the section it moved
 * to (the PR's mapping table). Layout, Sections and Widgets split: each
 * control is looked for where it went. The welcome message (General) is the
 * one gone: nothing has drawn it since the old header (spec §15).
 */
const s = screen;
const MOVED_CONTROLS = {
  general: [
    ['appearance', () => s.getByPlaceholderText('JAGHELM')],
    ['appearance', () => s.getByPlaceholderText('Infrastructure Dashboard')],
    ['appearance', () => s.getByRole('button', { name: 'Upload New' })],
  ],
  appearance: [
    ['appearance', () => s.getByRole('radiogroup', { name: 'Theme' })],
    ['appearance', () => s.getByRole('switch', { name: 'Subsystem strip' })],
    ['appearance', () => s.getByRole('button', { name: 'Upload Image' })],
    ['appearance', () => s.getByRole('slider', { name: /Overlay opacity/ })],
    ['appearance', () => s.getByRole('switch', { name: 'Dot grid' })],
  ],
  typography: [['appearance', () => s.getByRole('radiogroup', { name: 'Font family' })]],
  layout: [
    ['system', () => s.getByText(/Auto-refresh Interval/)],
    ['apps', () => s.getByRole('radiogroup', { name: 'Open links in' })],
    ['appearance', () => s.getByRole('radiogroup', { name: 'Units' })],
    ['appearance', () => s.getByRole('radiogroup', { name: 'Card blur' })],
  ],
  sections: [
    ['appearance', () => s.getByRole('switch', { name: 'Quick Launch' })],
    ['appearance', () => s.getByRole('switch', { name: 'Pipeline' })],
    ['appearance', () => s.getByRole('switch', { name: 'Checklist' })],
    ['nodes', () => s.getByRole('button', { name: '+ New Group' })],
  ],
  nodes: [
    ['nodes', () => within(s.getByRole('region', { name: 'Nodes' })).findByText('Gateway')],
    ['nodes', () => s.findByRole('button', { name: 'Edit' })],
  ],
  services: [
    ['nodes', () => within(s.getByRole('region', { name: 'Services' })).findByText('Gateway')],
  ],
  integrations: [
    ['integrations', () => s.findByRole('region', { name: 'Connected' })],
    ['integrations', () => s.findByRole('region', { name: 'Add an integration' })],
  ],
  links: [
    [
      'apps',
      () => within(s.getByRole('region', { name: 'Quick Launch links' })).getByText('Gitea'),
    ],
    ['apps', () => s.getByRole('button', { name: 'Add group' })],
  ],
  widgets: [
    ['apps', () => s.getByRole('switch', { name: 'Show the web search on the Launch page' })],
    ['apps', () => s.getByRole('combobox', { name: 'Search engine' })],
    ['appearance', () => s.getByRole('switch', { name: 'Weather' })],
    ['appearance', () => s.getByLabelText('Latitude')],
    ['appearance', () => s.getByLabelText('Longitude')],
    ['appearance', () => s.getByLabelText('City')],
    ['appearance', () => s.getByRole('switch', { name: 'Clock' })],
    ['appearance', () => s.getByRole('radiogroup', { name: 'Units' })],
  ],
  tabs: [
    ['apps', () => within(s.getByRole('region', { name: 'Embedded apps' })).getByText('Netdata')],
    ['apps', () => s.getByRole('button', { name: 'Add app' })],
  ],
  security: [
    ['system', () => s.getByPlaceholderText('Enter current password')],
    ['system', () => s.getByRole('button', { name: 'Change Password' })],
  ],
  backup: [
    ['system', () => s.getByRole('button', { name: 'Export Config' })],
    ['system', () => s.getByText('Choose File')],
  ],
};

describe('every control of the 13 tabs is in a section', () => {
  it('walks all 13', () => {
    expect(Object.keys(MOVED_CONTROLS)).toEqual([
      'general',
      'appearance',
      'typography',
      'layout',
      'sections',
      'nodes',
      'services',
      'integrations',
      'links',
      'widgets',
      'tabs',
      'security',
      'backup',
    ]);
  });

  it.each(Object.entries(MOVED_CONTROLS))(
    'what %s had is where its address goes, or where each part went',
    async (old, controls) => {
      // The old address opens the section most of it went to.
      const onSectionChange = vi.fn();
      render(<Harness section={old} onSectionChange={onSectionChange} />);
      const goesTo = MOVED_SECTIONS[old] ?? old;
      if (goesTo !== old) expect(onSectionChange).toHaveBeenCalledWith(goesTo);
      expect(controls.map(([section]) => section)).toContain(goesTo);
      cleanup();
      for (const [section, find] of controls) {
        render(<Harness section={section} />);
        expect(await find(), `${old} → ${section}`).toBeInTheDocument();
        cleanup();
      }
    }
  );

  it('the welcome message is gone from every section', async () => {
    for (const { id } of SETTINGS_SECTIONS) {
      render(<Harness section={id} />);
      await waitFor(() => expect(screen.queryByText(/Welcome/)).toBeNull());
      cleanup();
    }
  });
});
