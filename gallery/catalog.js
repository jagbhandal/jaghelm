/*
 * The gallery's catalogue (#289, docs/GALLERY.md): every state of every src/ui
 * component the design system lists, as plain data, so the Playwright tests
 * can read it without a bundler. What each state draws is in states.jsx, under
 * the same id; the tests fail when the two disagree.
 *
 *   id        the state's stable name; a variant adds the switches:
 *             `button--dark-comfortable`, `button--light-comfortable-cyan`
 *   group     the design-system section it belongs to
 *   title     what the state shows
 *   accent    colour that follows the accent: also drawn in Fuchsia and Cyan
 *   isolated  needs the page to itself: an open overlay, focus or toasts.
 *             It renders alone at ?state=<id>, filling the viewport, and the
 *             full gallery page shows it in a frame.
 *   focus     the element to focus once it has rendered (a selector): a focus
 *             ring, or a tooltip that opens on focus
 *   hover     the element the tests put the pointer on once the page is
 *             ready (a selector), for a state that opens under the pointer;
 *             its `wait` then applies after the hover
 *   wait      for an isolated state, the elements it waits for before it is
 *             ready: { selector: count }
 *
 * Every state is drawn in both themes and both densities with the default
 * accent (Violet). An `accent` state is also drawn in Fuchsia and Cyan, in
 * both themes, at the default density: density is spacing and never changes
 * a colour.
 */

export const THEMES = Object.freeze(['dark', 'light']);
export const DENSITIES = Object.freeze(['comfortable', 'compact']);
export const ACCENTS = Object.freeze(['violet', 'fuchsia', 'cyan']);

/** Set by the page once the state it shows has rendered, fonts included. */
export const READY_ATTRIBUTE = 'data-gallery-ready';
/** On the element of each state, whose id is the state's. */
export const STATE_ATTRIBUTE = 'data-gallery-state';

const s = (id, group, title, flags = {}) => Object.freeze({ id, group, title, ...flags });

export const CATALOG = Object.freeze([
  // Controls (#285)
  s('button', 'Controls', 'Button: each variant at md and sm, with icons, and a link', {
    accent: true,
  }),
  s('button-disabled', 'Controls', 'Button: each variant disabled'),
  s('button-focus', 'Controls', 'Button: the focus ring', {
    accent: true,
    isolated: true,
    focus: '[data-gallery-focus]',
    wait: { '[data-gallery-focus]:focus-visible': 1 },
  }),
  s('icon-button', 'Controls', 'IconButton: ghost, secondary and accent, md and sm, disabled'),
  s('input', 'Controls', 'Input: placeholder, value, disabled and invalid'),
  s('input-focus', 'Controls', 'Input: the focus ring, 1px out', {
    accent: true,
    isolated: true,
    focus: '[data-gallery-focus]',
    wait: { '[data-gallery-focus]:focus-visible': 1 },
  }),
  s('select', 'Controls', 'Select: placeholder, a choice, disabled and invalid'),
  s('select-open', 'Controls', 'Select: the list open, a choice ticked, an option disabled', {
    accent: true,
    isolated: true,
    wait: { '[data-slot="select-popup"]': 1 },
  }),
  s('switch', 'Controls', 'Switch: off, on, and both disabled', { accent: true }),
  s('checkbox', 'Controls', 'Checkbox: empty, checked, mixed, disabled and invalid', {
    accent: true,
  }),
  s(
    'field',
    'Controls',
    'Field: help text, an error, disabled, and around a Select and a segmented control'
  ),
  s(
    'segmented-control',
    'Controls',
    'SegmentedControl: two to four options, icons, a disabled option'
  ),
  s('tabs', 'Controls', 'Tabs: the active tab, icons, a disabled tab', { accent: true }),
  s('tab-focus', 'Controls', 'Tabs: the focus ring, inset', {
    accent: true,
    isolated: true,
    focus: '[data-gallery-focus]',
    wait: { '[data-gallery-focus]:focus-visible': 1 },
  }),

  // Containers (#286)
  s('panel', 'Containers', 'Panel: icon, description and actions', { accent: true }),
  s('panel-flush', 'Containers', 'Panel: flush, with rows'),
  s('panel-untitled', 'Containers', 'Panel: no title'),
  s('dialog-sm', 'Containers', 'Dialog: sm, with a Field and a footer', {
    isolated: true,
    wait: { '[data-slot="dialog"]': 1 },
  }),
  s('dialog-md', 'Containers', 'Dialog: md, with a Field and a footer', {
    isolated: true,
    wait: { '[data-slot="dialog"]': 1 },
  }),
  s('dialog-lg', 'Containers', 'Dialog: lg, with a Field and a footer', {
    isolated: true,
    wait: { '[data-slot="dialog"]': 1 },
  }),
  s('drawer', 'Containers', 'Drawer: eyebrow, title, description, a Banner and actions', {
    isolated: true,
    wait: { '[data-slot="drawer"]': 1 },
  }),
  s('confirm-destructive', 'Containers', 'Confirm: destructive, focus on Cancel', {
    isolated: true,
    wait: { '[data-slot="confirm-cancel"]:focus': 1 },
  }),
  s('confirm', 'Containers', 'Confirm: not destructive, focus on Confirm', {
    isolated: true,
    wait: { '[data-slot="confirm"] [data-slot="button"]:focus': 1 },
  }),
  s('popover', 'Containers', 'Popover: open, with a title and a description', {
    isolated: true,
    wait: { '[data-slot="popover"]': 1 },
  }),
  s('popover-hover', 'Containers', 'Popover: openOnHover, an infotip, under the pointer', {
    isolated: true,
    hover: '[data-gallery-hover]',
    wait: { '[data-slot="popover"]': 1 },
  }),
  s('tooltip-name', 'Containers', 'Tooltip: open on focus, repeating the name', {
    isolated: true,
    focus: '[data-gallery-focus]',
    wait: { '[data-slot="tooltip"]': 1 },
  }),
  s('tooltip-description', 'Containers', 'Tooltip: open on focus, adding a description', {
    isolated: true,
    focus: '[data-gallery-focus]',
    wait: { '[data-slot="tooltip"]': 1 },
  }),
  s('toasts', 'Containers', 'Toasts: neutral, ok and warn', {
    isolated: true,
    wait: { '[data-slot="toast"]': 3 },
  }),
  s('toasts-urgent', 'Containers', 'Toasts: crit (an alert that stays), and one with an action', {
    isolated: true,
    wait: { '[data-slot="toast"]': 2 },
  }),
  s('banner', 'Containers', 'Banner: every tone, with detail and an action'),
  s('banner-plain', 'Containers', 'Banner: every tone, without detail or action'),
  s('empty-state', 'Containers', 'EmptyState: md with an icon and an action, and sm'),
  s('skeleton', 'Containers', 'Skeleton: lines, a chip, a circle and a block'),

  // Status components (#287)
  s('status-lamp', 'Status', 'StatusLamp: every state at sm, lg and 20px'),
  s('status-word', 'Status', 'StatusWord: every state, its own word and a given one'),
  s('status-badge', 'Status', 'StatusBadge: every state'),
  s('issue-row', 'Status', 'IssueRow: from 672px, as a link, a button and plain content'),
  s('issue-row-narrow', 'Status', 'IssueRow: below 672px, the phone row'),
  s('subsystem-strip', 'Status', 'SubsystemStrip: six tiles in a row from 816px'),
  s('subsystem-strip-narrow', 'Status', 'SubsystemStrip: six tiles in rows of three, and of two'),
  s('subsystem-strip-counts', 'Status', 'SubsystemStrip: four and five tiles, wide and narrow'),
  s('subsystem-strip-selectable', 'Status', 'SubsystemStrip: toggles, one selected', {
    accent: true,
  }),
  s('attention-panel', 'Status', 'AttentionPanel: an incident, with its issues'),
  s('attention-panel-filtered', 'Status', 'AttentionPanel: filtered to a subsystem'),
  s(
    'attention-panel-filtered-empty',
    'Status',
    'AttentionPanel: filtered to a subsystem with nothing'
  ),
  s('attention-panel-quiet', 'Status', 'AttentionPanel: the quiet line'),
  s(
    'attention-panel-quiet-filtered',
    'Status',
    'AttentionPanel: the quiet line, filtered to a subsystem'
  ),
  s('attention-panel-maintenance', 'Status', 'AttentionPanel: the quiet line in maintenance'),
  s(
    'attention-panel-first-run',
    'Status',
    'AttentionPanel: the quiet line on a first run, nothing monitored yet'
  ),
  s('attention-panel-narrow', 'Status', 'AttentionPanel: an incident below 672px'),
  s(
    'subsystem-strip-no-signal',
    'Status',
    'SubsystemStrip: a stale status, every tile no signal, its count last known'
  ),
  s(
    'attention-panel-no-signal',
    'Status',
    'AttentionPanel: a stale status, no signal, what it last knew and its issues in steel'
  ),
  s(
    'attention-panel-phone',
    'Status',
    'AttentionPanel: below 768px, split around the strip, an incident with six issues'
  ),
  s(
    'attention-panel-phone-quiet',
    'Status',
    "AttentionPanel: below 768px, quiet, the Phone board's healthy card with the strip under it"
  ),
  s(
    'attention-panel-phone-no-signal',
    'Status',
    'AttentionPanel: below 768px, split around the strip, a stale status in steel'
  ),

  // Data components (#288) and chart colours (#386)
  s(
    'metric-meter',
    'Data',
    'MetricMeter: below, at and past its thresholds, over the top, no reading',
    {
      accent: true,
    }
  ),
  s('sparkline', 'Data', 'Sparkline: line, area, auto domain, a gap, too few points, full width'),
  s('sparkline-tooltip', 'Data', 'Sparkline: the keyboard on the latest point', {
    isolated: true,
    focus: '[data-slot="sparkline-chart"]',
    wait: { '[data-slot="sparkline-tooltip"]': 1 },
  }),
  s(
    'uptime-bar',
    'Data',
    'UptimeBar: sm, md and lg, failures, pending, maintenance, padding, no data'
  ),
  s('entity-row', 'Data', 'EntityRow: from 672px, every state, a long name'),
  s('entity-row-narrow', 'Data', 'EntityRow: below 672px, the newest 12 beats'),
  s('fact-list', 'Data', "FactList: the drawer's and the phone's"),
  s('fact-list-long', 'Data', 'FactList: values with no break in them, a URL, a SHA and a host'),
  s('table', 'Data', 'Table: rows that open, numbers, a status cell'),
  s('table-empty', 'Data', 'Table: no rows'),
  s('table-scroll', 'Data', 'Table: wider than its frame, scrolling inside it'),
  s(
    'chart-colours',
    'Data',
    'Chart colours: the six slots and the ramp, on bg, surface-1 and surface-2'
  ),

  // The Overview's sections (#299)
  s('infrastructure', 'Overview', 'InfrastructureSection: cards, every node healthy', {
    accent: true,
  }),
  s(
    'infrastructure-incident',
    'Overview',
    'InfrastructureSection: cards, a warning, a critical node and one with no signal',
    { accent: true }
  ),
  s('infrastructure-table', 'Overview', 'InfrastructureSection: the table, in the incident', {
    accent: true,
  }),
  s(
    'infrastructure-narrow',
    'Overview',
    "InfrastructureSection: a phone's width, a card a row, no toggle (the table needs 720px)"
  ),
  s(
    'infrastructure-no-signal',
    'Overview',
    'InfrastructureSection: the incident with a stale status, every node and meter no signal'
  ),
  // The Services section (#300)
  s('services', 'Overview', 'ServicesSection: by node, healthy and muted, no custom group yet', {
    accent: true,
  }),
  s(
    'services-incident',
    'Overview',
    'ServicesSection: a service down, one pending, one with no signal, one in maintenance',
    { accent: true }
  ),
  s(
    'services-grouped',
    'Overview',
    'ServicesSection: by custom group, the node beside each name, a long name'
  ),
  s(
    'services-no-signal',
    'Overview',
    'ServicesSection: the incident with a stale status, every row no signal'
  ),
  s(
    'services-narrow',
    'Overview',
    'ServicesSection: a phone\'s width, the name over "metric · latency"'
  ),
  // The Overview as a tablet draws it (#302, spec §8)
  s(
    'overview-tablet',
    'Overview',
    "The Overview in a 768px window: one column, the strip in rows of three, a card a row, the phone's rows"
  ),
  s(
    'overview-tablet-wide',
    'Overview',
    'The Overview in a 1024px window: one column, the strip in one row, two cards a row'
  ),

  // Shell (#296)
  s(
    'app-header',
    'Shell',
    'AppHeader: an incident, healthy on Settings, no signal, and before the first answer',
    { accent: true }
  ),
  s('app-header-first-run', 'Shell', 'AppHeader: a first run, nothing monitored yet'),
  s(
    'app-header-no-signal',
    'Shell',
    'AppHeader: no signal, with what was last known, and with nothing known'
  ),
  s('side-nav', 'Shell', 'SideNav: an open app, loaded apps, the Alerts count, Add app', {
    accent: true,
  }),
  s('side-nav-collapsed', 'Shell', 'SideNav: collapsed to icons, Alerts open', { accent: true }),
  s('side-nav-unload', 'Shell', 'SideNav: Unload on a loaded app, by keyboard', {
    isolated: true,
    focus: 'button[aria-label="Unload Uptime Kuma"]',
    wait: { 'button[aria-label="Unload Uptime Kuma"]:focus-visible': 1 },
  }),
  s(
    'bottom-tabs',
    'Shell',
    "BottomTabs: the phone's five tabs, Infrastructure drawn Infra, Alerts open with its count",
    {
      accent: true,
    }
  ),
  s('app-bar', 'Shell', 'AppBar: over an open app, with Reload and Open in new tab'),

  // The phone screens on the web, below 768px (#303), on the mock's Phone board
  s(
    'phone-overview',
    'Phone',
    "The phone's Overview: the incident's status card, strip and issues, then Services and Infrastructure as lists"
  ),
  s(
    'phone-overview-healthy',
    'Phone',
    "The phone's Overview, healthy: the status card all normal, the strip, the lists"
  ),
  s(
    'phone-overview-no-signal',
    'Phone',
    "The phone's Overview, no signal: what it last knew, every lamp steel"
  ),
  s(
    'phone-service-detail',
    'Phone',
    "A detail's sheet: Back and its kind, the service down, its facts and Open"
  ),

  // Sign-in (#305)
  s('login', 'Sign-in', 'LoginForm: the brand, the labelled fields and Sign in'),
  s('login-busy', 'Sign-in', 'LoginForm: signing in, the button busy'),
  s('login-error', 'Sign-in', 'LoginForm: a wrong password, the error on its field'),
  s('login-no-answer', 'Sign-in', "LoginForm: JagHelm didn't answer, the form's alert"),

  // The utilities (#301)
  s(
    'utilities-rail',
    'Utilities',
    "The Overview's rail at 1440px: weather and the clock, Quick Launch, Pipeline and the Checklist, one task overdue"
  ),
  s(
    'launch-page',
    'Utilities',
    'The Launch page: weather and the clock beside the web search, Quick Launch, then Pipeline and the Checklist'
  ),
  s(
    'utilities-empty',
    'Utilities',
    'Empty: no links yet (the Launch page), no recent commits, nothing on the list'
  ),
  s('utilities-failing', 'Utilities', "Failing: Gitea isn't answering, the checklist didn't load"),
  s(
    'utilities-weather',
    'Utilities',
    'WeatherClock (#307): the clock alone, a long condition in °F, the first reading on its way, no reading'
  ),
]);

/**
 * Every variant of `state` as { id, theme, density, accent }: both themes in
 * both densities with Violet, then, for an accent state, Fuchsia and Cyan in
 * both themes at the default density.
 */
export function variantsOf(state) {
  const out = [];
  for (const theme of THEMES) {
    for (const density of DENSITIES) {
      out.push({ id: `${state.id}--${theme}-${density}`, theme, density, accent: 'violet' });
    }
  }
  if (state.accent) {
    for (const accent of ACCENTS.slice(1)) {
      for (const theme of THEMES) {
        out.push({
          id: `${state.id}--${theme}-${DENSITIES[0]}-${accent}`,
          theme,
          density: DENSITIES[0],
          accent,
        });
      }
    }
  }
  return out.map((v) => Object.freeze({ ...v, state }));
}

/** Every variant of every state, in catalogue order. */
export const VARIANTS = Object.freeze(CATALOG.flatMap(variantsOf));

/** The variant whose id is `id`, or null. */
export function variantById(id) {
  return VARIANTS.find((v) => v.id === id) ?? null;
}
