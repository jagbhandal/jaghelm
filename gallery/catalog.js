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
    'chart',
    'Data',
    'Chart: one series on 0–100 %, fitted to its readings, a gap, Prometheus failing, no readings, loading'
  ),
  s(
    'chart-series',
    'Data',
    'Chart: three series solid; six (CPU by node) with slots 4 to 6 dashed, legend and every line labelled'
  ),
  s(
    'chart-thresholds',
    'Data',
    'Chart: warn and crit reference lines with their words (healthy; flagged with the breached span and a max band; a floor), loading, failed'
  ),
  s(
    'ranked-bars',
    'Data',
    'RankedBars: disk runway flagged with lamps, container growers with a sparkline a row, healthy, loading, failed, empty'
  ),
  s(
    'ranked-bars-keyboard',
    'Data',
    'RankedBars: the keyboard on the first row: focus ring, row highlight',
    {
      isolated: true,
      focus: '[data-slot="ranked-bars-rows"]',
      wait: { '[data-slot="ranked-bars-row"][data-active]': 1 },
    }
  ),
  s(
    'daily-bars',
    'Data',
    'DailyBars: two weeks of cost, the last day partial and lighter ("so far"), a gap, loading, failed, empty'
  ),
  s(
    'daily-bars-tooltip',
    'Data',
    'DailyBars: the keyboard on the latest day: crosshair, tooltip with the rate line',
    {
      isolated: true,
      focus: '[data-slot="daily-bars-plot"]',
      wait: { '[data-slot="daily-bars-tooltip"]': 1 },
    }
  ),
  s(
    'chart-crosshair',
    'Data',
    'Chart: the keyboard on the latest point: crosshair, dots, tooltip',
    {
      accent: true,
      isolated: true,
      focus: '[data-slot="chart-plot"]',
      wait: { '[data-slot="chart-tooltip"]': 1 },
    }
  ),
  s(
    'monitoring-section',
    'Data',
    'MonitoringSection: with a chart and a failed chart, while loading, and the page’s note'
  ),
  s(
    'stat-tile',
    'Data',
    'StatTile: a figure with its note, with no reading ("No reading", never 0), and a long note'
  ),
  s(
    'monitoring-power-draw',
    'Data',
    'Monitoring, Power draw: 24 h with the runtime tile, lowest and highest and the UPS footnote; 30 d with the max band; no UPS; no runtime reading; Prometheus failing'
  ),
  s(
    'monitoring-monthly-cost',
    'Data',
    'Monitoring, Monthly cost: month-to-date and projected tiles with daily bars (today lighter); since the 2nd; no rate set (kWh, link to Settings); no projection yet; no UPS; failing'
  ),
  s(
    'monitoring-disk-runway',
    'Data',
    'Monitoring, Disk runway: ranked days left with warning and critical lamps, noisy, no signal and not filling in words (no bar), and the dashed projection to full; no dates; no nodes; failing'
  ),
  s(
    'monitoring-memory-growers',
    'Data',
    'Monitoring, Container memory growers: ranked bars of 7-day growth with a trend per row; nothing grew; the recording rule missing (not available, with the cause); no container series; Prometheus failing'
  ),
  s(
    'event-strip',
    'Data',
    'EventStrip: restarts and OOM kills, a row per container, under a Chart on the same axis (flagged); nothing in range (healthy); loading; Prometheus failing'
  ),
  s(
    'small-multiples',
    'Data',
    'SmallMultiples: a grid of one chart per node on a shared scale (healthy, flagged, a no-data cell, highlighted), loading, failed'
  ),
  s(
    'small-multiples-phone',
    'Data',
    'SmallMultiples, phone: list rows with a sparkline that open the chart (healthy; flagged, no data, highlighted), loading, failed'
  ),
  s(
    'event-strip-crosshair',
    'Data',
    'EventStrip: the keyboard on the latest event: marker, hairline, tooltip',
    {
      accent: true,
      isolated: true,
      focus: '[data-slot="event-strip-plot"]',
      wait: { '[data-slot="event-strip-tooltip"]': 1 },
    }
  ),
  s(
    'monitoring-restarts',
    'Data',
    'Monitoring, Restarts and OOM kills: a row per container with events (circle restart, cross OOM kill) and the source limits; nothing in range; a node and the OOM counter unread; no containers; failing'
  ),
  s(
    'area-chart',
    'Data',
    'AreaChart: mirrored in/out, a node off (the area breaks), a plain area, Prometheus failing, no readings, loading'
  ),
  s(
    'area-chart-crosshair',
    'Data',
    'AreaChart: the keyboard on the latest point: crosshair, both dots, tooltip with in and out',
    {
      accent: true,
      isolated: true,
      focus: '[data-slot="area-chart-plot"]',
      wait: { '[data-slot="area-chart-tooltip"]': 1 },
    }
  ),
  s(
    'uptime-bar',
    'Data',
    'UptimeBar: sm, md and lg, failures, pending, maintenance, padding, no data, stale'
  ),
  s('uptime-bar-tooltip', 'Data', "UptimeBar: the drawer's strip focused, the newest check's tooltip", {
    isolated: true,
    focus: '[data-slot="uptime-bar"]',
    wait: { '[data-slot="uptime-bar-tooltip"]': 1 },
  }),
  s('entity-row', 'Data', 'EntityRow: from 672px, every state, a long name'),
  s('entity-row-narrow', 'Data', 'EntityRow: below 672px, the newest 12 beats'),
  s('fact-list', 'Data', "FactList: the drawer's and the phone's"),
  s('fact-list-long', 'Data', 'FactList: values with no break in them, a URL, a SHA and a host'),
  s(
    'entity-detail-node',
    'Data',
    "The detail's parts: a Proxmox node's meters, machines, pools on the disk rule, last backup and links",
    { accent: true }
  ),
  s(
    'entity-detail-history',
    'Data',
    "The detail's history: a node's Usage and Temperature at 1 h, a container's charts with Prometheus failing"
  ),
  s(
    'detail-drives',
    'Data',
    "DetailDrives (#728): a NAS node's three healthy drives with the standby note, and an NVMe alone with none"
  ),
  s(
    'detail-drives-cadence',
    'Data',
    "DetailDrives (#732): a node that declares its readings' interval: one footnote for the interval and the sleeping drive, and an NVMe alone with the interval only"
  ),
  s(
    'detail-drives-trouble',
    'Data',
    'DetailDrives: a failing drive marked and open beside a warm one, a stable pile of bad sectors and an NVMe; a warning from growing bad sectors open beside an NVMe with its spare at the line'
  ),
  s(
    'detail-drives-no-signal',
    'Data',
    "DetailDrives: every drive the exporter no longer reports as a ring with No signal and nothing to open; a stale status's rows all as no signal with their last words"
  ),
  s(
    'entity-detail-drives',
    'Data',
    "A node's detail with a failing drive (#728): the status box saying why, the Drives under it with the failing one marked and open, and the temperature chart with a line for each drive and the note for those not drawn"
  ),
  s(
    'entity-detail-service',
    'Data',
    "The detail's parts: a service's heartbeats, container and integration stats, a read that failed, its links"
  ),
  s(
    'entity-detail-job',
    'Data',
    "The detail's parts: a backup's schedule, the overdue line over its last runs, a failed run's error, Remove and why it failed"
  ),
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
  // Compose stacks (#642)
  s(
    'services-stacks',
    'Overview',
    'ServicesSection: a Compose stack is one row with its +N chip: one with a container down (critical), one with a container stopped (warning), healthy ones, and Collabora beside Nextcloud as a row of its own',
    { accent: true }
  ),
  s(
    'services-stacks-narrow',
    'Overview',
    "ServicesSection: a phone's width, the chip after the stack's name"
  ),
  s(
    'stack-panel',
    'Data',
    "A stack's detail: Degraded with the failing container named, the lead's heartbeats and response time, its containers with Set lead, Ungroup, Details and Split out, Open",
    { accent: true }
  ),
  s('stack-panel-healthy', 'Data', "A stack's detail, every container running"),
  s('stack-panel-stopped', 'Data', "A stack's detail with a container stopped (a warning)"),
  s('stack-panel-phone', 'Data', "A stack's detail at a phone's width (the sheet)"),
  // The Jobs section (#578)
  s('jobs', 'Overview', 'JobsSection: jobs and backups, all well and muted', { accent: true }),
  s(
    'jobs-incident',
    'Overview',
    'JobsSection: a failed backup, a failed job, an overdue job and one with no signal'
  ),
  s(
    'jobs-narrow',
    'Overview',
    'JobsSection: a phone\'s width, the name over "detail · last report"'
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

  // The Services and Infrastructure pages (#313): the Overview's sections, with their filters
  s('list-filters', 'Pages', 'ListFilters: a search, State and Node chosen, Clear filters', {
    accent: true,
  }),
  s(
    'services-page',
    'Pages',
    'The Services page: filtered to Problems, the services it leaves, the List / Table toggle',
    { accent: true }
  ),
  s('services-page-table', 'Pages', 'The Services page: the table, every service by node'),
  s(
    'services-page-empty',
    'Pages',
    'The Services page: filters that leave no service, and Clear filters'
  ),
  s(
    'infrastructure-page',
    'Pages',
    'The Infrastructure page: filtered to Problems, the nodes it leaves, a Role filter',
    { accent: true }
  ),

  // Shell (#296)
  s(
    'app-header',
    'Shell',
    'AppHeader: an incident, healthy on Settings, no signal, and before the first answer',
    { accent: true }
  ),
  s(
    'layout-editor',
    'Overview',
    'LayoutEditor (#330): sections with move and show switches, a pinned service, a group, the list to pin from'
  ),
  s(
    'layout-editor-narrow',
    'Overview',
    "LayoutEditor at a tablet column's width: the rows wrap, every control still a button"
  ),
  s('app-header-edit-layout', 'Shell', 'AppHeader: the Edit layout toggle, off and on (#330)'),
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
  s(
    'phone-header',
    'Shell',
    "PhoneHeader: below 768px, the Phone board's: the shield and the name, the theme toggle; a long name cut short"
  ),

  // The phone screens on the web, below 768px (#303), on the mock's Phone board
  s(
    'phone-overview',
    'Phone',
    "The phone's Overview under its header: the incident's status card, strip and issues, then Services and Infrastructure as lists"
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
    "A detail's sheet: Back and its kind, the service down, its heartbeats, its facts and Open"
  ),
  s(
    'phone-ups-detail',
    'Phone',
    "The UPS's sheet on battery: its charge, runtime left, load and model, all from the status"
  ),
  s(
    'phone-node-history',
    'Phone',
    "A node's sheet (#602): under the status box, the drawer's History, Usage and Temperature at 1 h, the range switch 44px tall"
  ),
  s(
    'phone-node-drives',
    'Phone',
    "A node's sheet with a failing drive (#728): the status box saying why, the Drives block under it with a warm drive, a failing one and an NVMe, then the meters and services"
  ),
  s(
    'phone-container-history',
    'Phone',
    "A container's sheet (#602): its CPU and Memory under the status box at 7 d, the days on one time axis"
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
    "The Overview's rail at 1440px: weather and the clock, Quick Launch, Pipeline (passed, failed on a branch, running, a repo without CI) and the Checklist, one task overdue"
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

  // Settings (#317)
  s(
    'settings-index',
    'Settings',
    'SettingsIndex: the search, then a card per section (its icon in the accent chip, its name and line), and that changes apply at once',
    { accent: true }
  ),
  s(
    'settings-index-search',
    'Settings',
    'SettingsIndex: a search, "link": the section it finds, and its settings that matched',
    { accent: true }
  ),
  s(
    'settings-section',
    'Settings',
    "SettingsSectionPage: the breadcrumb, the section's name and line, the list of sections beside it, the open one marked",
    { accent: true }
  ),
  s(
    'settings-appearance',
    'Settings',
    'Settings → Appearance (#321): theme, accent (the chosen swatch ringed), density, font family, branding, background, Overview sections and widgets, each in a panel',
    { accent: true }
  ),
  // Custom themes (#331)
  s(
    'themes-panel',
    'Settings',
    'Theme and Custom themes: a custom theme as a card chosen among dark, light and system, the list of those that loaded, and a rejected one with the pairing it breaks and Remove'
  ),
  s(
    'themes-import-rejected',
    'Settings',
    'Custom themes: a pasted theme whose secondary text is too dim, rejected with the pairing named and Import off'
  ),
  s(
    'themes-import-ready',
    'Settings',
    'Custom themes: a pasted theme that passes, with Import on'
  ),
  s(
    'themed-screen-midnight',
    'Settings',
    'A panel, text in each level, buttons and a banner drawn in the example custom theme (dark base)'
  ),
  s(
    'themed-screen-paper',
    'Settings',
    'The same drawn in a custom theme with a light base that sets only the page colour'
  ),
  // One state per typeface in src/ui/typefaces.js (#660); gallery/gallery.spec.mjs
  // fails if this list and the registry disagree.
  s(
    'typeface-manrope',
    'Settings',
    'Font family: Manrope (the default) chosen, and text, figures and a path drawn in it'
  ),
  s(
    'typeface-plus-jakarta-sans',
    'Settings',
    'Font family: Plus Jakarta Sans chosen, and text, figures and a path drawn in it'
  ),
  s(
    'typeface-montserrat',
    'Settings',
    'Font family: Montserrat chosen, and text, figures and a path drawn in it'
  ),
  s(
    'settings-appearance-notice',
    'Settings',
    "Settings → Appearance at a phone's width: an old accent colour mapped to the nearest, which the Accent panel says until dismissed"
  ),
  s(
    'settings-apps',
    'Settings',
    'Settings → Apps & links (#362): four apps (one embeds, one blocks, one could not be checked, one opens in a new browser tab), Quick Launch groups (one empty), where links open and the web search',
    { accent: true }
  ),
  s(
    'settings-energy-empty',
    'Settings',
    'Settings → System → Energy cost (#743) with no rate: the currency symbol (applies once a rate is added), the empty state and Add a rate'
  ),
  s(
    'settings-energy',
    'Settings',
    'Settings → System → Energy cost with two rates: the newest labelled Current, each with its date, its price per kWh and Remove'
  ),
  s(
    'settings-energy-error',
    'Settings',
    "Settings → System → Energy cost at a phone's width: a symbol too long, a price over 10 and a repeated date, each said on its field, and Not saved yet"
  ),
  s(
    'settings-apps-blocked',
    'Settings',
    "Settings → Apps & links at a phone's width: the add form after the embedding check found the site blocks embedding, before anything is saved, offering a new tab"
  ),
  s(
    'settings-notifications',
    'Settings',
    'Settings → Notifications (#320, #653): the thresholds with the disk set away from its defaults, the categories, Alerts on this device (on), two devices (one with push off and a failed send), a browser with alerts on, and a test push to all three',
    { accent: true }
  ),
  s(
    'settings-notifications-off',
    'Settings',
    "Settings → Notifications at a phone's width with push off on the server: no phone, the thresholds still editable, one line refused on its row"
  ),
  s(
    'drive-health-setting',
    'Settings',
    "Drive health (#728) at a phone's width: the switch on and off, locked, with where JAGHELM_DRIVES sets it"
  ),
  s(
    'web-push-device',
    'Settings',
    "Alerts on this device (#653) at a phone's width: off with its one button, and on after a test alert with Send test alert and Turn off"
  ),
  s(
    'web-push-problems',
    'Settings',
    "Alerts on this device at a phone's width where it cannot be turned on: notifications blocked, not installed on iPhone, unsupported browser, Web Push off on the server with the fix, and an expired subscription with a refusal"
  ),
  s(
    'access-expired',
    'Containers',
    "The sign-in-again notice (#653) when Cloudflare Access's session has ended, with its Reload button"
  ),
  s(
    'alerts-stopped',
    'Containers',
    "The alerts-stopped notice (#653): alerts were on for this phone and no longer are, with its one button"
  ),
  s(
    'settings-integrations',
    'Settings',
    'Settings → Integrations (#323): four integrations as the board words them (one failing with its reason, a custom one with its endpoint in services.yaml, one disabled) and the preset gallery',
    { accent: true }
  ),
  s(
    'settings-integrations-empty',
    'Settings',
    "Settings → Integrations at a phone's width: none set up, the empty state with its Custom integration button, and the presets"
  ),
  s(
    'settings-integrations-form',
    'Settings',
    'IntegrationForm: editing an integration with its URL refused for holding a credential beside the field, a stored password kept, a failed test and Remove (a Confirm)',
    { accent: true }
  ),
  s(
    'settings-services',
    'Settings',
    'Settings → Nodes & Services (#319): services by node with their real monitor tags (monitored by name, no monitor, opted out), Loki open on the Auto-match suggestion with a similar name beside it, and the backup jobs, one no longer reporting',
    { accent: true }
  ),
  s(
    'settings-services-stack',
    'Settings',
    'Settings → Nodes & Services: a container drawn inside a Compose stack, its editor with Set lead…, Ungroup and Split out',
    { accent: true }
  ),
  s(
    'settings-services-phone',
    'Settings',
    "ServiceMap at a phone's width: a container on several nodes with no match, only a similar name to choose, and no cron job reported yet"
  ),
  s(
    'settings-sources',
    'Settings',
    'SourceList (#318): Settings → Sources, every source answering for 3 h, each set in .env, and the cron reporters reporting, with a link to the Jobs section',
    { accent: true }
  ),
  s(
    'settings-sources-failed',
    'Settings',
    "SourceList at a phone's width: services.yaml unusable, Prometheus failed with its error, Gitea not set up, and the cron reporters warning with a job failed and one overdue"
  ),

  // The command palette (#315)
  s(
    'command-palette',
    'Command palette',
    'CommandPalette: a row in every group (issues, each subsystem, pages, apps, Settings, Quick Launch, Log out), the first highlighted; the list scrolls',
    { isolated: true, wait: { '[data-slot="command-palette"] input:focus-visible': 1 } }
  ),
  s(
    'command-palette-search',
    'Command palette',
    'CommandPalette: a search, "gra": the groups with a match, names that start with it first',
    { isolated: true, wait: { '[data-slot="command-palette"] input:focus-visible': 1 } }
  ),

  // The alert history and the Alerts page (#314)
  s(
    'alert-history',
    'Status',
    'AlertHistory: from 672px, a day at a time: each kind of change, what the phones got, a removed entity, a notice, Show older'
  ),
  s(
    'alert-history-narrow',
    'Status',
    'AlertHistory: below 672px, the phone row; a long name stays whole, its change on the next line'
  ),
  s(
    'alert-filters',
    'Status',
    'AlertFilters: nothing chosen, then warnings on nodes matching a search, with Clear filters',
    { accent: true }
  ),
  s(
    'alert-history-states',
    'Status',
    'AlertHistory: loading, nothing in 30 days, a server without a history, unavailable, a refresh that failed'
  ),
  s(
    'alerts-page',
    'Alerts',
    "The Alerts page at 912px: the filters, Active (the incident's issues), then History by day"
  ),
  s(
    'alerts-page-filtered',
    'Alerts',
    'The Alerts page filtered to warnings on nodes: Showing … only, Clear filters, both views narrowed'
  ),
  s(
    'phone-alerts',
    'Phone',
    "The phone's Alerts tab under its header: the search and chips, Active, then History by day"
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
