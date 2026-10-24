/**
 * What the command palette finds (#315, spec UX audit m8): every row ⌘K can
 * open, grouped, and the search over them. The palette draws them
 * (src/ui/command-palette.jsx); src/components/CommandPalette.jsx feeds it.
 *
 *   paletteIndex   every group, in this order: the current issues (the
 *                  model's order, worst first); each entity with an address
 *                  (#309), one group per subsystem in the model's order
 *                  (Services, Nodes, Power, Jobs, Backups, Integrations); the
 *                  nav's pages; the embedded apps; Settings' sections; the
 *                  Quick Launch links (Settings → Apps & links); then Log out
 *   paletteSearch  the groups again, each with only the rows a query
 *                  matches, best first, the groups by their best row, and
 *                  none left empty
 *
 * Each row is what the palette draws and what it opens: `{ id, label, kind,
 * where, detail, state, word, href, onOpen, target }`, and `terms`, words it
 * is found by and doesn't draw (a Settings section's parts, the tabs they
 * came from and other words for them, sections.js; #317). An entity or an issue
 * opens with the rows' own helper (entityNav.js `useEntityLink`), its URL
 * over the page under the palette; a page, an app or a Settings section with
 * `navigate`; a Quick Launch link is a link with Quick Launch's target, as the
 * panel draws it (src/ui/utilities.jsx). Themes are not here: the header's
 * button and Settings → Appearance switch them.
 */
import { pathTo } from '../router/routes.js';
import { drawnState } from './statusFreshness.js';
import { whereOf } from './statusView.js';
import { linkGroups } from './utilities.js';

/** Each entity kind as a row's kind names it, as the detail drawer's overline does. */
const KIND = Object.freeze({
  service: 'Service',
  container: 'Container',
  node: 'Node',
  ups: 'UPS',
  job: 'Job',
  backup: 'Backup',
  integration: 'Integration',
  agent: 'Arcane agent',
});

/** A subsystem the model has no name for, by its id: "jobs" is "Jobs". */
const titled = (id) => String(id).charAt(0).toUpperCase() + String(id).slice(1);

/** The host of a link's address, as a row says where it goes: "grafana.lan". */
const hostOf = (href) => href.replace(/^(https?:\/\/|mailto:)/, '').replace(/\/$/, '');

/**
 * Every group the palette lists, in order, each `{ id, heading, rows }`, with
 * no empty group.
 *
 * @param {object} options
 * @param {object | null} options.status the status model (docs/ARCHITECTURE.md §4.7), or null before the first
 * @param {boolean} [options.stale] the status is out of date (statusFreshness.js): every lamp is drawn as no signal, as the rows elsewhere are
 * @param {Array<{ id: string, label: string, href: string }>} [options.pages] the nav's pages
 * @param {Array<{ id: string, label: string, href: string, external?: boolean }>} [options.apps] the embedded apps (`external`: opens in a new browser tab, #362)
 * @param {Array<{ id: string, label: string, desc?: string, disabled?: boolean, settings?: Array<{ name: string, words?: string }> }>} [options.sections] Settings' sections
 * @param {object} [options.links] the config's Quick Launch links, by group
 * @param {string} [options.linkTarget] where a Quick Launch link opens (Settings → Apps & links)
 * @param {(id: string) => { href: string, onOpen: () => void }} options.entityLink an entity's link, as its rows have it
 * @param {(href: string) => void} options.navigate opens a page of this app
 * @param {(() => void) | null} [options.onLogout] Log out, when there is a sign-in
 */
export function paletteIndex({
  status,
  stale = false,
  pages = [],
  apps = [],
  sections = [],
  links,
  linkTarget,
  entityLink,
  navigate,
  onLogout = null,
}) {
  const freshness = { stale };
  const groups = [];
  const add = (id, heading, rows) => {
    if (rows.length > 0) groups.push({ id, heading, rows });
  };
  const inApp = (href) => ({ href, onOpen: () => navigate(href) });

  add(
    'issues',
    'Issues',
    (status?.issues ?? []).map((e) => ({
      id: `issue:${e.id}`,
      label: e.name,
      kind: 'Issue',
      where: whereOf(e),
      detail: e.reason,
      state: drawnState(e.state, freshness),
      word: e.word,
      ...entityLink(e.id),
    }))
  );

  const entities = (status?.entities ?? []).filter((e) => KIND[e.kind]);
  const subsystems = [
    ...(status?.subsystems ?? []).map((s) => ({ id: s.id, name: s.name })),
    ...entities.map((e) => ({ id: e.subsystem, name: titled(e.subsystem) })),
  ].filter((s, i, all) => all.findIndex((x) => x.id === s.id) === i);
  for (const subsystem of subsystems) {
    add(
      `entities:${subsystem.id}`,
      subsystem.name,
      entities
        .filter((e) => e.subsystem === subsystem.id)
        .map((e) => ({
          id: `entity:${e.id}`,
          label: e.name,
          kind: KIND[e.kind],
          where: e.node,
          detail: e.word,
          state: drawnState(e.state, freshness),
          word: e.word,
          ...entityLink(e.id),
        }))
    );
  }

  add(
    'pages',
    'Pages',
    pages.map((p) => ({ id: `page:${p.id}`, label: p.label, kind: 'Page', ...inApp(p.href) }))
  );
  add(
    'apps',
    'Apps',
    apps.map((a) => ({
      id: `app:${a.id}`,
      label: `Open ${a.label}`,
      kind: 'App',
      ...(a.external
        ? { detail: 'Opens in a new tab', href: a.href, target: '_blank' }
        : { detail: 'Opens inside JagHelm', ...inApp(a.href) }),
    }))
  );
  add(
    'settings',
    'Settings',
    sections
      .filter((s) => !s.disabled)
      .map((s) => ({
        id: `settings:${s.id}`,
        label: s.label,
        kind: 'Settings',
        detail: s.desc,
        terms: (s.settings ?? []).map((p) => `${p.name} ${p.words ?? ''}`).join(' '),
        ...inApp(pathTo('settings', { section: s.id })),
      }))
  );
  add(
    'links',
    'Quick Launch',
    linkGroups(links).flatMap((group) =>
      group.links.map((link) => ({
        id: `link:${group.key}:${link.id}`,
        label: `Open ${link.name}`,
        kind: 'Link',
        where: group.title,
        detail: hostOf(link.href),
        href: link.href,
        target: linkTarget || '_blank',
      }))
    )
  );
  if (onLogout) {
    add('actions', 'Actions', [
      { id: 'action:logout', label: 'Log out', kind: 'Action', onOpen: onLogout },
    ]);
  }
  return groups;
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether a word of `text` starts with `word`: at its start, or after anything but a letter or digit. */
const startsAWord = (text, word) =>
  new RegExp(`(^|[^\\p{L}\\p{N}])${escape(word)}`, 'u').test(text);

/**
 * Whether `row`, in the group headed `heading`, matches each of `words` (lower
 * case): anywhere in its name, and only at the start of a word in its kind,
 * where, detail, word, terms or heading, so "ups" finds the UPS, not the
 * Backups heading or "custom groups".
 */
function matches(row, heading, words) {
  const name = row.label.toLowerCase();
  const rest = [row.kind, row.where, row.detail, row.word, row.terms, heading]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return words.every((w) => name.includes(w) || startsAWord(rest, w));
}

/**
 * How well `label` matches `query` (lower case): 0, it starts with it; 1, a
 * word of it does; 2, it holds it; 3, only the row's other words do.
 */
function rank(label, query) {
  const l = label.toLowerCase();
  if (l.startsWith(query)) return 0;
  if (startsAWord(l, query)) return 1;
  if (l.includes(query)) return 2;
  return 3;
}

/**
 * The groups with only the rows `query` matches (each of its words in the
 * row's name, or at a word's start in its other words: `matches`). Within a
 * group, rows whose name starts with the query come first, then those with a
 * word that does, then those that hold it, each in the group's order. The
 * groups follow their best row, a name or any word of it starting with the
 * query counting alike, so a name that does is never under rows that only
 * hold it ("gr": Grafana before Settings' Integrations), and a failing
 * nightly-backup stays over Settings › System ("backup"); groups that tie keep their order,
 * the issues first. A group with no match is left out. An empty query
 * matches everything, as it is.
 *
 * @param {Array<{ id: string, heading: string, rows: object[] }>} groups
 * @param {string} query
 */
export function paletteSearch(groups, query) {
  const q = String(query ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!q) return groups;
  const words = q.split(' ');
  const found = [];
  groups.forEach((group, g) => {
    const ranked = group.rows
      .map((row, i) => ({ row, i }))
      .filter(({ row }) => matches(row, group.heading, words))
      .map(({ row, i }) => ({ row, i, rank: rank(row.label, q) }))
      .sort((a, b) => a.rank - b.rank || a.i - b.i);
    if (ranked.length > 0) {
      // Starting the name or a word of it are one step here.
      const best = Math.max(ranked[0].rank, 1);
      found.push({ g, best, group: { ...group, rows: ranked.map((r) => r.row) } });
    }
  });
  return found.sort((a, b) => a.best - b.best || a.g - b.g).map((f) => f.group);
}
