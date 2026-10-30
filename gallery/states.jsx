/*
 * What each gallery state draws (#289), keyed by its id in catalog.js. Each is
 * a component, rendered inside a UiRoot with the variant's switches
 * (main.jsx), so it can use hooks.
 *
 * Layout here is inline styles reading the role tokens, and classes only where
 * a component's own API asks for one (a Skeleton's shape, a Sparkline's
 * `w-full`): the gallery loads the production stylesheet unchanged, which only
 * holds the classes src/ui/ uses (scripts/gallery-build.test.mjs checks the
 * few named here). Data is fixed, times included, so every render is the same.
 */
import { createElement, useContext, useEffect, useState } from 'react';
import {
  Activity,
  Bell,
  Database,
  Ellipsis,
  History,
  Inbox,
  Info,
  LayoutDashboard,
  LayoutGrid,
  Monitor,
  Moon,
  Palette,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Rocket,
  ScrollText,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Trash2,
} from 'lucide-react';
import { Button, buttonVariants } from '@ui/button';
import { cn } from '@ui/lib/utils';
import { IconButton } from '@ui/icon-button';
import { Input } from '@ui/input';
import { Select } from '@ui/select';
import { Switch } from '@ui/switch';
import { Checkbox } from '@ui/checkbox';
import { Field } from '@ui/field';
import { SegmentedControl } from '@ui/segmented-control';
import { Tabs, TabList, Tab, TabPanel } from '@ui/tabs';
import {
  ChartFocusTag,
  MonitoringNote,
  MonitoringOther,
  MonitoringSection,
  chartFocus,
} from '@ui/monitoring-section';
import { Panel } from '@ui/panel';
import { UiRoot } from '@ui/root';
import { FontChoice, ThemeChoice } from '@ui/appearance';
import { TYPEFACES } from '../src/ui/typefaces.js';
import { Dialog, DialogClose } from '@ui/dialog';
import { Drawer, DrawerClose } from '@ui/drawer';
import { Confirm } from '@ui/confirm';
import { Popover } from '@ui/popover';
import { Tooltip } from '@ui/tooltip';
import { useToast } from '@ui/toast';
import { Banner } from '@ui/banner';
import { EmptyState } from '@ui/empty-state';
import { Skeleton } from '@ui/skeleton';
import { StatusLamp } from '@ui/status-lamp';
import { StatusWord, StatusBadge } from '@ui/status-word';
import { IssueRow } from '@ui/issue-row';
import { SubsystemStrip } from '@ui/subsystem-strip';
import { AttentionPanel } from '@ui/attention-panel';
import { MetricMeter } from '@ui/metric-meter';
import { Sparkline } from '@ui/sparkline';
import { Chart, ChartGroup } from '@ui/chart';
import { EventStrip } from '@ui/event-strip';
import { RankedBars } from '@ui/ranked-bars';
import { DailyBars } from '@ui/daily-bars';
import { StatTile } from '@ui/stat-tile';
import { AreaChart } from '@ui/area-chart';
import { SmallMultiples } from '@ui/small-multiples';
import { DetailCharts } from '@ui/detail-charts';
import { DetailDrives } from '@ui/detail-drives';
import { DriveHealthSetting } from '@ui/drive-health';
import { driveView } from '../src/shell/detail/driveView.js';
import { hdd, nasWith, nvme, sectors } from '../src/testing/driveFixtures.js';
import { UptimeBar } from '@ui/uptime-bar';
import { EntityRow } from '@ui/entity-row';
import { FactList } from '@ui/fact-list';
import {
  DetailHeartbeats,
  DetailLinks,
  DetailMeters,
  DetailRemove,
  DetailSections,
  DetailUnread,
} from '@ui/entity-detail';
import { Table } from '@ui/table';
import { InfrastructureSection } from '@ui/infrastructure-section';
import { ServicesSection } from '@ui/services-section';
import { ListFilters } from '@ui/list-filters';
import { ServicesTable } from '@ui/services-table';
import { JobsSection } from '@ui/jobs-section';
import { AppHeader, PhoneHeader, UpdatedAgo } from '@ui/app-header';
import { SideNav, appMonogram } from '@ui/side-nav';
import { BottomTabs } from '@ui/bottom-tabs';
import { AppBar } from '@ui/app-bar';
import { LoginForm } from '@ui/login-form';
import { CommandPalette } from '@ui/command-palette';
import {
  Checklist,
  LaunchLayout,
  Pipeline,
  QuickLaunch,
  UtilitiesRail,
  WeatherClock,
  WebSearch,
} from '@ui/utilities';
// The phone screens (#303): the shared ones, in the web's look.
import PhoneNodeDetail from '../src/phone/views/NodeDetail.jsx';
import PhoneOverview from '../src/phone/views/Overview.jsx';
import PhoneServiceDetail from '../src/phone/views/ServiceDetail.jsx';
import PhoneDetail from '../src/shell/PhoneDetail.jsx';
import { PhonePlatform } from '../src/phone/platform.js';
import { phoneBoard, phoneBoardNoSignal } from './phoneBoard.js';
import { decodeBeats } from '../server/kumaBeats.js';
// The alert history and the Alerts page (#314).
import { AlertHistory } from '@ui/alert-history';
import { AlertFilters } from '@ui/alert-filters';
import { AlertsContent } from '../src/shell/AlertsPage.jsx';
import { ChartPanel } from '../src/shell/MonitoringPage.jsx';
import { PhoneChartPanel } from '../src/phone/views/Monitoring.jsx';
import { monitoringRangeOf } from '../src/shell/monitoring.js';
import { WebAlertsView } from '../src/phone/views/Alerts.jsx';
import { NO_FILTERS, historyView } from '../src/shell/alertsView.js';
import { ALERT_EVENTS, ALERTS_NOW } from './alertEvents.js';
import { SettingsIndex, SettingsNav, SettingsPart, SettingsSectionPage } from '@ui/settings';
import { SETTINGS_SECTIONS } from '../src/components/settings/sections.js';
// Settings → Appearance (#321): the section itself, over a display config.
import { RootSwitchesContext } from '@ui/lib/portal';
import { ConfigProvider } from '../src/context/ConfigContext.jsx';
import { GROUP_NONE, LayoutEditor } from '@ui/layout-editor';
import Appearance from '../src/components/settings/sections/Appearance.jsx';
// Custom themes (#331).
import CustomThemesPanel from '../src/components/settings/sections/CustomThemes.jsx';
import { themeVars, validateThemes } from '../server/themes.js';
import midnightTheme from '../docs/examples/midnight-theme.json';
// Settings → Apps & links (#362).
import AppsLinks from '../src/components/settings/sections/AppsLinks.jsx';
// Settings → System → Energy cost (#743).
import EnergyCost from '../src/components/settings/sections/EnergyCost.jsx';
import { Group } from '../src/components/settings/primitives.jsx';
import { OverlayProvider } from '../src/context/OverlayContext.jsx';
// Settings → Notifications (#320).
import { ThresholdTable } from '@ui/threshold-table';
import { PushCategories, PushDevices } from '@ui/push-devices';
import { WebPushDevice } from '@ui/web-push';
import AccessExpired from '@ui/access-expired';
import AlertsStopped from '@ui/alerts-stopped';
import { METRIC_WORDS } from '../src/components/settings/sections/notificationsData.js';
// Settings → Integrations (#323).
import { IntegrationForm, IntegrationList, PresetGallery } from '@ui/integrations';
// Settings → Nodes & Services (#319).
import { BackupJobList, ServiceMap } from '@ui/service-mapping';
import { DetailStack } from '@ui/stack-panel';
import { DetailStatus as PhoneDetailStatus } from '../src/phone/components/DetailParts.jsx';
// Settings → Sources (#318).
import { SourceList } from '@ui/source-list';
import {
  configRow,
  cronRow,
  sourceRows,
} from '../src/components/settings/sections/sourcesView.js';

// ---------------------------------------------------------------- layout

const noop = () => {};

function Stack({ gap = 16, width, children }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap, width }}>{children}</div>;
}

function Row({ gap = 12, align = 'center', children }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: align, gap }}>{children}</div>
  );
}

function Grid({ columns, gap = 16, width, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: columns, gap, width, alignItems: 'start' }}>
      {children}
    </div>
  );
}

/** A short caption for what follows, in text-2 (checked on the page and panels). */
function Caption({ children }) {
  return <p style={{ color: 'var(--jh-text-2)', fontSize: 12, lineHeight: '16px' }}>{children}</p>;
}

/** A labelled control in a row: the label wraps it, as the mock's settings rows. */
function Labelled({ children }) {
  return <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{children}</label>;
}

function List({ children }) {
  return <ul className="divide-y divide-border">{children}</ul>;
}

// ---------------------------------------------------------------- fixtures

// 08:00 to 08:58 UTC on 2026-10-20, every 2 minutes.
const T0 = Date.UTC(2026, 9, 20, 8, 0);
const series = (values) => values.map((value, i) => ({ time: T0 + i * 120_000, value }));

const CPU = series([
  22, 24, 21, 28, 35, 31, 27, 26, 30, 42, 38, 33, 29, 27, 25, 31, 36, 34, 30, 28, 26, 29, 33, 37,
  41, 36, 32, 30, 34, 38,
]);
const MEMORY = series([
  61, 61, 62, 62, 63, 63, 64, 64, 64, 65, 66, 66, 67, 68, 68, 69, 70, 71, 71, 72, 73, 73, 74, 75,
  75, 76, 77, 77, 78, 78,
]);
const LATENCY = series([
  92, 88, 95, 101, 97, 90, 86, 112, 140, 131, 104, 96, 91, 89, 93, 99, 105, 98, 94, 90, 87, 92, 97,
  103, 99, 95, 91, 94, 96, 93,
]);
const GAPPED = series([
  30,
  32,
  35,
  33,
  null,
  null,
  null,
  38,
  41,
  39,
  36,
  34,
  37,
  40,
  43,
  41,
  38,
  null,
  36,
  35,
  33,
  31,
  34,
  37,
  39,
  42,
  40,
  38,
  36,
  35,
]);

const beats = (pattern) =>
  [...pattern].map((c) => ({ o: 'ok', x: 'crit', w: 'warn', m: 'maintenance', '.': null })[c]);
const BEATS_OK = beats('oooooooooooooooooooooooooooooo');
const BEATS_FAILING = beats('ooooooooooooooooooooooooooxxxx');
const BEATS_FLAKY = beats('oooooooxooooooooooooooxooooooo');
const BEATS_PENDING = beats('oooooooooooooooooooowwoooooooo');
const BEATS_MAINTENANCE = beats('oooooooooooooooommmmmmmmmmoooo');
const BEATS_NONE = beats('..............................');

// Checks as the server's strips give them (#312, server/kumaBeats.js
// decodeBeats): each beat's word, time and response time, one every 30 s,
// the newest 20 s before the gallery's 09:00 UTC. A pattern reads oldest
// first: o up, x down, w pending, m maintenance, . no data.
const CHECK_LOOK = {
  o: ['ok', 'Up'],
  x: ['crit', 'Down'],
  w: ['warn', 'Pending'],
  m: ['maintenance', 'Maintenance'],
  '.': ['unknown', 'No data'],
};
const CHECKS_END = Date.UTC(2026, 9, 20, 9, 0, 0) - 20_000;
const checks = (pattern, ping = 40) =>
  [...pattern].map((c, i, all) => {
    const [state, word] = CHECK_LOOK[c];
    return {
      state,
      word,
      time: CHECKS_END - (all.length - 1 - i) * 30_000,
      ping: c === 'o' ? ping + ((i * 7) % 9) - 4 : null,
    };
  });
const up = (n) => 'o'.repeat(n);
const CHECKS_UP = up(40);
// Down for a minute ten minutes ago, after a check pending, then up again.
const CHECKS_BLIP = `${up(17)}wxx${up(20)}`;
// Down for the last 4 minutes (the mock's "HTTP 502 for 4 min").
const CHECKS_DOWN = `${up(31)}w${'x'.repeat(8)}`;
const CHECKS_PENDING = `${up(38)}ww`;
const CHECKS_NO_SIGNAL = `${up(37)}...`;
const CHECKS_MAINTENANCE = `${up(30)}${'m'.repeat(10)}`;

const ISSUES = [
  {
    id: 'immich',
    state: 'crit',
    word: 'Down',
    title: 'Immich',
    where: 'Service · Production (vm-103)',
    reason: 'Kuma: HTTP 502 for 4 min',
    age: '4 m',
    href: '#immich',
  },
  {
    id: 'ups',
    state: 'crit',
    word: 'On battery',
    title: 'UPS',
    where: 'Power',
    reason: '82 % charge · about 31 min runtime left',
    age: '2 m',
    onOpen: noop,
  },
  {
    id: 'disk',
    state: 'warn',
    word: 'Warning',
    title: 'vm-101 disk',
    where: 'Node · Staging',
    reason: '/ is 86 % full, 41 GB free',
    age: '1 h',
    onOpen: noop,
  },
  {
    id: 'wiki',
    state: 'unknown',
    word: 'No signal',
    title: 'Wiki.js',
    where: 'Service · Production (vm-103)',
    reason: 'No heartbeat yet',
    age: '2 m',
  },
];

const MAINTENANCE_ISSUE = {
  id: 'ha',
  state: 'maintenance',
  word: 'Maintenance',
  title: 'Home Assistant',
  where: 'Service · pi-1',
  reason: 'Kuma maintenance until 10:00',
  age: '20 m',
  onOpen: noop,
};

// An incident strip, each tile's value and sub-line in the model's words
// (server/status/summary.js tileOf, #541): a count over its word and what is
// in maintenance or has no signal, the UPS's word over its charge.
const CELLS = [
  {
    key: 'services',
    label: 'Services',
    state: 'crit',
    word: 'Down',
    value: '30 / 32',
    sub: '1 down · 1 no signal',
  },
  {
    key: 'nodes',
    label: 'Nodes',
    state: 'warn',
    word: 'Warning',
    value: '5 / 6',
    sub: '1 in warning',
  },
  {
    key: 'power',
    label: 'Power',
    state: 'crit',
    word: 'On battery',
    value: 'On battery',
    sub: '82 % charge',
  },
  {
    key: 'jobs',
    label: 'Jobs',
    state: 'ok',
    value: '14 / 14',
    sub: 'OK',
  },
  {
    key: 'backups',
    label: 'Backups',
    state: 'maintenance',
    word: 'Maintenance',
    value: '1 / 2',
    sub: 'OK · 1 in maintenance',
  },
  {
    key: 'integrations',
    label: 'Integrations',
    state: 'unknown',
    word: 'No signal',
    value: '11 / 12',
    sub: 'OK · 1 no signal',
  },
];

const INCIDENT = {
  state: 'crit',
  counts: '2 critical, 1 warning, 1 no signal',
  subline: 'Immich is down and the UPS is on battery.',
};

const NODES = [
  {
    id: 'vm-103',
    name: 'Production',
    host: 'vm-103',
    state: 'ok',
    cpu: '34 %',
    memory: '61 %',
    disk: '48 %',
    uptime: '41 d',
  },
  {
    id: 'vm-101',
    name: 'Staging',
    host: 'vm-101',
    state: 'warn',
    word: 'Disk',
    cpu: '12 %',
    memory: '44 %',
    disk: '86 %',
    uptime: '41 d',
  },
  {
    id: 'pi-1',
    name: 'DNS primary',
    host: 'pi-1',
    state: 'ok',
    cpu: '7 %',
    memory: '38 %',
    disk: '22 %',
    uptime: '9 d',
  },
  {
    id: 'nas',
    name: 'JagNAS',
    host: 'jagnas',
    state: 'unknown',
    cpu: '—',
    memory: '—',
    disk: '—',
    uptime: '—',
  },
];

const NODE_COLUMNS = [
  {
    key: 'name',
    header: 'Node',
    cell: (row) => (
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
        {row.name}
        <code style={{ fontSize: 12, fontWeight: 400, color: 'var(--jh-text-3)' }}>{row.host}</code>
      </span>
    ),
  },
  {
    key: 'state',
    header: 'Status',
    cell: (row) => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <StatusLamp state={row.state} decorative />
        <StatusWord state={row.state} word={row.word} />
      </span>
    ),
  },
  { key: 'cpu', header: 'CPU', numeric: true },
  { key: 'memory', header: 'Memory', numeric: true },
  { key: 'disk', header: 'Disk', numeric: true },
  { key: 'uptime', header: 'Uptime', numeric: true },
];

const NODE_ITEMS = [
  { value: 'vm-103', label: 'Production (vm-103)' },
  { value: 'vm-101', label: 'Staging (vm-101)' },
  { value: 'pi-1', label: 'DNS primary (pi-1)' },
  { value: 'pi-2', label: 'DNS secondary (pi-2)', disabled: true },
];

const UPS_FACTS = [
  { key: 'charge', label: 'Charge', value: '82 %' },
  { key: 'runtime', label: 'Runtime', value: 'about 31 min' },
  { key: 'load', label: 'Load', value: '18 %, 96 W' },
  { key: 'input', label: 'Input', value: <StatusWord state="crit" word="On battery" /> },
];

const SERVICE_FACTS = [
  { key: 'monitor', label: 'Monitor', value: 'HTTP(s), every 60 s' },
  { key: 'latency', label: 'Latency', value: '42 ms median' },
  { key: 'uptime', label: 'Uptime, 30 days', value: '99.94 %' },
  { key: 'host', label: 'Host', value: <code>vm-103</code> },
  { key: 'url', label: 'Address', value: 'https://photos.jagbhandal.com/api/server/ping' },
];

// The Infrastructure section's nodes (#299), as src/shell/infrastructureView.js
// gives them: the default lines (spec §6.1), each reading's state the model's,
// `shown` as the model's rule prints it.
const LINES = {
  cpu: { warn: 90, band: 5 },
  mem: { warn: 90, band: 5 },
  disk: { warn: 90, crit: 95, band: 5 },
  temp: { warn: 75, crit: 85, band: 5 },
};
const LABELS = { cpu: 'CPU', mem: 'Memory', disk: 'Disk', temp: 'Temp' };
const nodeReading = (key, value, state = 'ok') => ({
  key,
  label: LABELS[key],
  value,
  unit: key === 'temp' ? '°C' : '%',
  max: 100,
  state: value == null ? null : state,
  ...LINES[key],
  shown: value == null ? null : `${Math.floor(value)}${key === 'temp' ? '°C' : '%'}`,
});
const cpuTrend = (values) => ({
  points: values,
  label: 'CPU, last hour',
  formatValue: (v) => `${Math.floor(v)}%`,
});
const infraNode = (id, fields) => ({
  id: `nodes/${id}`,
  anchor: `entity-nodes/${id}`,
  host: id,
  reason: null,
  trend: null,
  uptime: null,
  ...fields,
});

const EDGE = infraNode('edge', {
  name: 'Network Edge',
  subtitle: 'Raspberry Pi 4',
  colour: '#a78bfa',
  state: 'ok',
  word: 'Healthy',
  readings: [
    nodeReading('cpu', 6.2),
    nodeReading('mem', 18.4),
    nodeReading('disk', 31.2),
    nodeReading('temp', 47.3),
  ],
  services: '5 / 5 services up',
  uptime: 'Up 41d 6h',
  trend: cpuTrend([5, 6, 7, 6, 5, 8, 9, 7, 6, 6, 5, 7, 8, 6, 6, 7, 6, 5, 6, 6]),
});
const APPS = infraNode('apps', {
  name: 'App Server',
  subtitle: 'Proxmox VM',
  colour: '#6366f1',
  state: 'ok',
  word: 'Healthy',
  readings: [nodeReading('cpu', 23.8), nodeReading('mem', 62.2), nodeReading('disk', 60.6)],
  services: '9 / 9 services up',
  uptime: 'Up 12d 3h',
  trend: cpuTrend([22, 24, 21, 28, 35, 31, 27, 26, 30, 42, 38, 33, 29, 27, 25, 31, 26, 24, 23, 24]),
});
const STORAGE = infraNode('storage', {
  name: 'Storage',
  subtitle: 'NAS',
  colour: '#14b8a6',
  state: 'ok',
  word: 'Healthy',
  readings: [
    nodeReading('cpu', 9.4),
    nodeReading('mem', 41.6),
    nodeReading('disk', 66.2),
    nodeReading('temp', 41.0),
  ],
  services: '5 / 5 services up',
  uptime: 'Up 87d 14h',
  trend: cpuTrend([8, 9, 11, 10, 9, 9, 12, 14, 11, 10, 9, 9, 8, 10, 9, 9, 10, 9, 9, 9]),
});
const NODES_HEALTHY = [EDGE, APPS, STORAGE];
const NODES_INCIDENT = [
  {
    ...STORAGE,
    state: 'warn',
    word: 'Warning',
    reason: 'Disk 94 % (warning above 90 %)',
    readings: [
      nodeReading('cpu', 9.4),
      nodeReading('mem', 41.6),
      nodeReading('disk', 94.6, 'warn'),
      nodeReading('temp', 41.0),
    ],
  },
  {
    ...APPS,
    state: 'crit',
    word: 'Critical',
    reason: 'Disk 96 % (critical above 95 %)',
    readings: [
      nodeReading('cpu', 23.8),
      nodeReading('mem', 62.2),
      nodeReading('disk', 96.2, 'crit'),
    ],
    services: '8 / 9 services up · 1 down',
  },
  {
    ...EDGE,
    state: 'unknown',
    word: 'No signal',
    reason: 'No data: Prometheus unreachable',
    readings: EDGE.readings.map((r) => nodeReading(r.key, null)),
    uptime: null,
    trend: null,
  },
  infraNode('media', {
    name: 'Media Server',
    subtitle: 'Docker host',
    colour: '#f472b6',
    state: 'ok',
    word: 'Healthy',
    readings: [nodeReading('cpu', 31.0), nodeReading('mem', 71.9), nodeReading('disk', 48.3)],
    services: '6 / 6 services up',
    uptime: 'Up 3d 2h',
    trend: cpuTrend([
      30, 34, 29, 33, 41, 36, 32, 30, 34, 38, 31, 30, 29, 33, 35, 31, 30, 32, 31, 31,
    ]),
  }),
];

// #495: the incident's nodes with a stale status: each node and reading no
// signal, the words, reasons and numbers kept.
const NODES_NO_SIGNAL = NODES_INCIDENT.map((n) => ({
  ...n,
  state: 'unknown',
  readings: n.readings.map((r) => ({ ...r, state: r.state == null ? null : 'unknown' })),
}));

// The Services section's groups (#300), as servicesView.js gives them.
const svc = (node, name, state, word, detail, meta, extra = {}) => ({
  id: `services/${node}:${name.toLowerCase().replace(/\W+/g, '-')}`,
  anchor: `entity-services/${node}:${name.toLowerCase().replace(/\W+/g, '-')}`,
  name,
  where: null,
  state,
  word,
  detail,
  meta,
  muted: state === 'ok',
  ...extra,
});
const SERVICES_HEALTHY = [
  {
    key: 'node:edge',
    title: 'Network Edge',
    host: 'edge',
    count: '3 / 3 up',
    rows: [
      svc('edge', 'AdGuard Home', 'ok', 'Up', '41,203 queries', '12 ms', {
        beats: checks(CHECKS_UP, 12),
      }),
      svc('edge', 'Nginx Proxy Manager', 'ok', 'Up', '31 proxy hosts', '18 ms', {
        beats: checks(CHECKS_UP, 18),
      }),
      // A container no monitor watches: no strip, its room kept.
      svc('edge', 'WireGuard', 'ok', 'Running', null, '—'),
    ],
  },
  {
    key: 'node:apps',
    title: 'App Server',
    host: 'apps',
    count: '4 / 4 up',
    rows: [
      svc('apps', 'Gitea', 'ok', 'Up', null, '41 ms', { beats: checks(CHECKS_UP, 41) }),
      svc('apps', 'Jellyfin', 'ok', 'Up', 'Version 10.9.1', '64 ms', {
        beats: checks(CHECKS_UP, 64),
      }),
      svc('apps', 'Nextcloud', 'ok', 'Up', '18,204 files', '142 ms', {
        beats: checks(CHECKS_BLIP, 142),
      }),
      svc('apps', 'Vaultwarden', 'ok', 'Up', null, '22 ms', { beats: checks(CHECKS_UP, 22) }),
    ],
  },
];
const SERVICES_INCIDENT = [
  {
    key: 'node:apps',
    title: 'App Server',
    host: 'apps',
    count: '2 / 5 up',
    rows: [
      svc('apps', 'Jellyfin', 'crit', 'Down', 'Kuma: down', '—', { beats: checks(CHECKS_DOWN, 64) }),
      svc('apps', 'Paperless', 'warn', 'Pending', 'Kuma: pending (retrying its check)', '—', {
        beats: checks(CHECKS_PENDING, 96),
      }),
      svc('apps', 'Wiki.js', 'unknown', 'No signal', 'Kuma: no status', '—', {
        beats: checks(CHECKS_NO_SIGNAL, 88),
      }),
      svc('apps', 'Gitea', 'ok', 'Up', null, '41 ms', { beats: checks(CHECKS_UP, 41) }),
      svc('apps', 'Nextcloud', 'ok', 'Up', '18,204 files', '142 ms', {
        beats: checks(CHECKS_BLIP, 142),
      }),
    ],
  },
  {
    key: 'node:storage',
    title: 'Storage',
    host: 'storage',
    count: '1 / 2 up',
    rows: [
      svc('storage', 'Backrest', 'maintenance', 'Maintenance', 'Kuma: in maintenance', '—', {
        beats: checks(CHECKS_MAINTENANCE, 33),
      }),
      svc('storage', 'Syncthing', 'ok', 'Up', null, '27 ms', { beats: checks(CHECKS_UP, 27) }),
    ],
  },
];
const SERVICES_GROUPED = [
  {
    key: 'group:media',
    title: 'Media',
    host: null,
    count: '1 / 2 up',
    rows: [
      svc('apps', 'Jellyfin', 'crit', 'Down', 'Kuma: down', '—', {
        where: 'App Server',
        beats: checks(CHECKS_DOWN, 64),
      }),
      svc('storage', 'PhotoPrism', 'ok', 'Up', '24,499 photos', '118 ms', {
        where: 'Storage',
        beats: checks(CHECKS_UP, 118),
      }),
    ],
  },
  {
    key: 'group:none',
    title: 'Not in a group',
    host: null,
    count: '2 / 2 up',
    rows: [
      svc('edge', 'AdGuard Home', 'ok', 'Up', '41,203 queries', '12 ms', {
        where: 'Network Edge',
        beats: checks(CHECKS_UP, 12),
      }),
      svc(
        'apps',
        'Paperless-ngx document archive and OCR pipeline',
        'ok',
        'Up',
        '9,812 documents',
        '96 ms',
        { where: 'App Server', beats: checks(CHECKS_UP, 96) }
      ),
    ],
  },
];
// #480: the incident with a stale status, every row no signal, its words
// kept, its strip's failures in no signal's solid (#312).
const SERVICES_NO_SIGNAL = SERVICES_INCIDENT.map((g) => ({
  ...g,
  rows: g.rows.map((r) => ({ ...r, state: 'unknown', stale: true })),
}));
const GROUPINGS = [
  { value: 'node', label: 'Node' },
  { value: 'group', label: 'Group' },
];

// The Jobs section's groups (#578), as jobsView.js gives them: the schedule
// while a job is well, the model's reason while it isn't, the last report.
const job = (id, state, word, detail, meta) => {
  const [, node, name] = /^\w+\/([^:]+):(.+)$/.exec(id);
  return { id, name, where: node, state, word, detail, meta, muted: true };
};
const JOBS_HEALTHY = [
  {
    key: 'jobs',
    title: 'Jobs',
    count: '4 / 4 OK',
    rows: [
      job('jobs/edge:npm-sync', 'ok', 'OK', 'every 15 min', '6 m ago'),
      job('jobs/edge:vaultwarden-sync', 'ok', 'OK', 'every 15 min', '6 m ago'),
      job('jobs/apps:image-prune', 'ok', 'OK', 'daily at 06:30', '3 h ago'),
      job('jobs/wiki:docs-health', 'ok', 'OK', 'daily at 02:00', '7 h ago'),
    ],
  },
  {
    key: 'backups',
    title: 'Backups',
    count: '3 / 3 OK',
    rows: [
      job('backups/apps:vm103-backup', 'ok', 'OK', 'daily 3am', '6 h ago'),
      job(
        'backups/storage:nas-b2-backup',
        'ok',
        'OK',
        'daily at 03:00 (Ofelia, America/Toronto)',
        '6 h ago'
      ),
      job('backups/pve:proxmox-backup', 'ok', 'OK', 'every 24 h', '7 h ago'),
    ],
  },
];
const JOBS_INCIDENT = [
  {
    key: 'jobs',
    title: 'Jobs',
    count: '2 / 4 OK · 1 no signal',
    rows: [
      job('jobs/apps:db-dump', 'warn', 'Failed', 'Last run failed: exit code 3', '1 h ago'),
      job(
        'jobs/apps:image-prune',
        'warn',
        'Overdue',
        'Overdue: no report on schedule (expected every 24 h)',
        '3 d ago'
      ),
      job('jobs/ci:runner-health', 'unknown', 'No signal', 'Last report has no status', '12 m ago'),
      job('jobs/edge:npm-sync', 'ok', 'OK', 'every 15 min', '6 m ago'),
    ],
  },
  {
    key: 'backups',
    title: 'Backups',
    count: '1 / 2 OK',
    rows: [
      job(
        'backups/storage:nas-b2-backup',
        'crit',
        'Failed',
        'Last backup failed: repository is locked by another process',
        '7 h ago'
      ),
      job('backups/pve:proxmox-backup', 'ok', 'OK', 'every 24 h', '7 h ago'),
    ],
  },
];

// ---------------------------------------------------------------- controls

const BUTTON_SIZES = ['md', 'sm'];

function ButtonState() {
  return (
    <Stack>
      {BUTTON_SIZES.map((size) => (
        <Row key={size}>
          <Button variant="primary" size={size}>
            Save changes
          </Button>
          <Button size={size}>Secondary</Button>
          <Button variant="ghost" size={size}>
            Ghost
          </Button>
          <Button variant="ghost" tone="accent" size={size}>
            <Pencil />
            Edit
          </Button>
          <Button variant="danger" size={size}>
            <Trash2 />
            Remove
          </Button>
          <Button variant="primary" size={size}>
            <Plus />
            Add service
          </Button>
          <Button size={size}>
            <RefreshCw />
            Reload
          </Button>
        </Row>
      ))}
      <Row>
        <a href="#settings" className={cn(buttonVariants({ variant: 'secondary' }))}>
          A link drawn as a button
        </a>
        <a
          href="#alerts"
          className={cn(buttonVariants({ variant: 'ghost', size: 'sm', tone: 'accent' }))}
        >
          All alerts
        </a>
      </Row>
    </Stack>
  );
}

function ButtonDisabledState() {
  return (
    <Stack>
      {BUTTON_SIZES.map((size) => (
        <Row key={size}>
          <Button variant="primary" size={size} disabled>
            Save changes
          </Button>
          <Button size={size} disabled>
            Secondary
          </Button>
          <Button variant="ghost" size={size} disabled>
            Ghost
          </Button>
          <Button variant="ghost" tone="accent" size={size} disabled>
            Edit
          </Button>
          <Button variant="danger" size={size} disabled>
            Remove
          </Button>
        </Row>
      ))}
    </Stack>
  );
}

function ButtonFocusState() {
  return (
    <Row>
      <Button variant="primary" data-gallery-focus>
        Save changes
      </Button>
      <Button>Cancel</Button>
    </Row>
  );
}

function IconButtonState() {
  return (
    <Stack>
      {BUTTON_SIZES.map((size) => (
        <Row key={size}>
          <IconButton label="Reload" size={size}>
            <RefreshCw />
          </IconButton>
          <IconButton label="Notifications" variant="secondary" size={size}>
            <Bell />
          </IconButton>
          <IconButton label="Edit" tone="accent" size={size}>
            <Pencil />
          </IconButton>
          <IconButton label="Remove" variant="danger" size={size}>
            <Trash2 />
          </IconButton>
          <IconButton label="Reload, disabled" size={size} disabled>
            <RefreshCw />
          </IconButton>
          <IconButton label="Notifications, disabled" variant="secondary" size={size} disabled>
            <Bell />
          </IconButton>
        </Row>
      ))}
    </Stack>
  );
}

function InputState() {
  return (
    <Grid columns="repeat(2, 280px)">
      <Field label="Name">
        <Input placeholder="Immich" />
      </Field>
      <Field label="Address">
        <Input defaultValue="https://photos.jagbhandal.com" />
      </Field>
      <Field label="Port" disabled>
        <Input defaultValue="2283" disabled />
      </Field>
      <Field label="Timeout" error="Use a number of seconds from 1 to 60.">
        <Input defaultValue="90" />
      </Field>
    </Grid>
  );
}

function InputFocusState() {
  return (
    <Stack width={280}>
      <Field label="Search" description="Services, nodes and issues.">
        <Input placeholder="Immich" data-gallery-focus />
      </Field>
    </Stack>
  );
}

function SelectState() {
  return (
    <Grid columns="repeat(2, 280px)">
      <Field label="Node">
        <Select items={NODE_ITEMS} placeholder="Choose a node" />
      </Field>
      <Field label="Runs on">
        <Select items={NODE_ITEMS} defaultValue="vm-103" />
      </Field>
      <Field label="Fallback" disabled>
        <Select items={NODE_ITEMS} defaultValue="pi-1" disabled />
      </Field>
      <Field label="Backup target" error="Pick a node that runs Proxmox.">
        <Select items={NODE_ITEMS} defaultValue="pi-1" />
      </Field>
    </Grid>
  );
}

function SelectOpenState() {
  return (
    <Stack width={280}>
      <Field label="Runs on">
        <Select items={NODE_ITEMS} defaultValue="vm-101" defaultOpen />
      </Field>
    </Stack>
  );
}

function SwitchState() {
  return (
    <Stack gap={12}>
      <Labelled>
        <Switch />
        Send push alerts
      </Labelled>
      <Labelled>
        <Switch defaultChecked />
        Show the weather
      </Labelled>
      <Labelled>
        <Switch disabled />
        Locked off
      </Labelled>
      <Labelled>
        <Switch defaultChecked disabled />
        Locked on
      </Labelled>
    </Stack>
  );
}

function CheckboxState() {
  return (
    <Stack gap={12}>
      <Labelled>
        <Checkbox />
        Open in a new browser tab
      </Labelled>
      <Labelled>
        <Checkbox defaultChecked />
        Back up before updating
      </Labelled>
      <Labelled>
        <Checkbox indeterminate />
        Some services
      </Labelled>
      <Labelled>
        <Checkbox disabled />
        Locked, empty
      </Labelled>
      <Labelled>
        <Checkbox defaultChecked disabled />
        Locked, checked
      </Labelled>
      <Field error="Tick this to go on.">
        <Labelled>
          <Checkbox />I have a backup
        </Labelled>
      </Field>
    </Stack>
  );
}

function FieldState() {
  return (
    <Grid columns="repeat(2, 280px)">
      <Field label="Display name" description="Shown on the Overview and in alerts.">
        <Input defaultValue="Production" />
      </Field>
      <Field label="Prometheus address" error="Prometheus didn't answer at this address.">
        <Input defaultValue="http://192.168.68.11:9091" />
      </Field>
      <Field label="Read-only" description="Set in config.yaml." disabled>
        <Input defaultValue="/opt/stacks" disabled />
      </Field>
      <Field label="Theme" description="System follows the device.">
        <Select
          items={[
            { value: 'system', label: 'System' },
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
          ]}
          defaultValue="system"
        />
      </Field>
      <Field label="Density">
        <SegmentedControl
          options={[
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'compact', label: 'Compact' },
          ]}
          defaultValue="comfortable"
        />
      </Field>
      <Field label="Push alerts" description="To every device signed in.">
        <Switch defaultChecked />
      </Field>
    </Grid>
  );
}

function SegmentedControlState() {
  return (
    <Stack>
      <SegmentedControl
        aria-label="Text size"
        options={[
          { value: 'default', label: 'Default' },
          { value: 'large', label: 'Large' },
        ]}
        defaultValue="default"
      />
      <SegmentedControl
        aria-label="Theme"
        options={[
          { value: 'dark', label: 'Dark', icon: Moon },
          { value: 'light', label: 'Light', icon: Sun },
          { value: 'system', label: 'System', icon: Monitor },
        ]}
        defaultValue="light"
      />
      <SegmentedControl
        aria-label="Range"
        options={[
          { value: '1h', label: '1 h' },
          { value: '6h', label: '6 h' },
          { value: '24h', label: '24 h' },
          { value: '7d', label: '7 d', disabled: true },
        ]}
        defaultValue="24h"
      />
    </Stack>
  );
}

function ServiceTabs({ focus = false }) {
  return (
    <Stack width={520}>
      <Tabs defaultValue="overview">
        <TabList aria-label="Immich">
          <Tab value="overview" data-gallery-focus={focus || undefined}>
            <LayoutGrid />
            Overview
          </Tab>
          <Tab value="history">
            <History />
            History
          </Tab>
          <Tab value="logs" disabled>
            <ScrollText />
            Logs
          </Tab>
        </TabList>
        <TabPanel value="overview">Up for 41 days. 24,499 assets, 42 ms median latency.</TabPanel>
        <TabPanel value="history">Two outages in the last 30 days.</TabPanel>
        <TabPanel value="logs">Logs need Loki.</TabPanel>
      </Tabs>
    </Stack>
  );
}

// ---------------------------------------------------------------- containers

function PanelState() {
  return (
    <Grid columns="repeat(2, 400px)">
      <Panel
        title="Quick launch"
        description="Your most used apps"
        icon={<Rocket />}
        actions={
          <Button variant="ghost" size="sm" tone="accent">
            Edit
          </Button>
        }
      >
        <p style={{ color: 'var(--jh-text-2)' }}>Immich, Gitea, Nextcloud and Home Assistant.</p>
      </Panel>
      <Panel title="Weather" icon={<Sun />}>
        <p>14 °C, light cloud. Rain from 16:00.</p>
      </Panel>
    </Grid>
  );
}

function ServiceRows() {
  return (
    <List>
      <li>
        <EntityRow state="ok" name="Immich" detail="24,499 assets" meta="42 ms" onOpen={noop} />
      </li>
      <li>
        <EntityRow
          state="crit"
          word="Down"
          name="Gitea"
          detail="Kuma: HTTP 502 for 4 min"
          meta="—"
          onOpen={noop}
        />
      </li>
      <li>
        <EntityRow
          state="ok"
          name="Nextcloud"
          detail="3 users signed in"
          meta="118 ms"
          onOpen={noop}
        />
      </li>
    </List>
  );
}

function PanelFlushState() {
  return (
    <Stack width={720}>
      <Panel
        flush
        title="Services"
        description="31 of 32 up"
        icon={<LayoutGrid />}
        actions={
          <Button variant="ghost" size="sm" tone="accent">
            All services
          </Button>
        }
      >
        <ServiceRows />
      </Panel>
    </Stack>
  );
}

function PanelUntitledState() {
  return (
    <Stack width={400}>
      <Panel>
        <p>A panel with no header: its content sits inside the density's padding.</p>
        <MetricMeter label="CPU" value={34} warn={75} crit={90} />
      </Panel>
    </Stack>
  );
}

function DialogState({ size }) {
  const copy = {
    sm: {
      title: 'Rename node',
      description: 'The name shows on the Overview and in alerts.',
      field: (
        <Field label="Name" description="Up to 40 characters.">
          <Input defaultValue="Production" />
        </Field>
      ),
    },
    md: {
      title: 'Add a link',
      description: "Links open in a new tab. Apps that can't load inside JagHelm open here too.",
      field: (
        <Field label="Address" error="Start the address with http:// or https://.">
          <Input defaultValue="photos.jagbhandal.com" />
        </Field>
      ),
    },
    lg: {
      title: 'Edit service',
      description: "Immich's monitor and where it runs.",
      field: (
        <Field label="Runs on" description="The node whose metrics show beside it.">
          <Select items={NODE_ITEMS} defaultValue="vm-103" />
        </Field>
      ),
    },
  }[size];
  return (
    <Dialog
      defaultOpen
      size={size}
      title={copy.title}
      description={copy.description}
      footer={
        <>
          <Button variant="primary">Save</Button>
          <DialogClose render={<Button variant="ghost">Cancel</Button>} />
        </>
      }
    >
      {copy.field}
    </Dialog>
  );
}

function DrawerState() {
  return (
    <Drawer defaultOpen eyebrow="Service" title="Immich" description="Production · vm-103">
      <Banner
        tone="crit"
        title="Down for 4 min"
        cause="Kuma: HTTP 502 from photos.jagbhandal.com"
        detail="Last check 08:58"
        action={<Button size="sm">Retry</Button>}
      />
      <FactList facts={SERVICE_FACTS} />
      <Row gap={8}>
        <Button variant="primary">Open Immich</Button>
        <DrawerClose render={<Button variant="ghost">Close</Button>} />
      </Row>
    </Drawer>
  );
}

function ConfirmDestructiveState() {
  return (
    <Confirm
      defaultOpen
      destructive
      title="Remove this device?"
      name="Pixel 8"
      detail="Android · added 12 Oct"
      description="It stops getting push alerts. You can sign it in again later."
      confirmLabel="Remove"
      value="device-7f3a"
    />
  );
}

function ConfirmState() {
  return (
    <Confirm
      defaultOpen
      title="Send a test alert?"
      name="Pixel 8"
      detail="Android · last seen 2 min ago"
      description="A test notification goes to this device only."
      confirmLabel="Send"
      value="device-7f3a"
    />
  );
}

function PopoverState() {
  return (
    <Popover
      defaultOpen
      trigger={<Button>Shows here</Button>}
      title="Shows here"
      description="Pinned apps open under the header and stay loaded, so they come back where you left them."
    />
  );
}

function PopoverHoverState() {
  return (
    <Row gap={8}>
      <span>Latency</span>
      <Popover
        openOnHover
        trigger={
          <IconButton label="About latency" size="sm" data-gallery-hover>
            <Info />
          </IconButton>
        }
        title="Latency"
        description="The median response time of the last 30 checks."
      />
    </Row>
  );
}

function TooltipNameState() {
  return (
    <Tooltip content="Reload">
      <IconButton label="Reload" data-gallery-focus>
        <RefreshCw />
      </IconButton>
    </Tooltip>
  );
}

function TooltipDescriptionState() {
  return (
    <Tooltip content="Still loaded: opens where you left it">
      <Button data-gallery-focus>Immich</Button>
    </Tooltip>
  );
}

/** Adds `toasts` once, from an effect, with ids (StrictMode-safe). */
function Toasts({ toasts }) {
  const toast = useToast();
  useEffect(() => {
    for (const t of toasts) toast.add(t);
  }, [toast, toasts]);
  return null;
}

const NOTES = [
  {
    id: 'gallery-saved',
    title: 'Checklist saved',
    description: 'Synced to your other devices.',
    timeout: 0,
  },
  { id: 'gallery-sent', title: 'Sent to 2 devices', tone: 'ok', timeout: 0 },
  {
    id: 'gallery-slow',
    title: 'Saved, but Gitea is slow',
    description: 'The activity panel may lag for a minute.',
    tone: 'warn',
    timeout: 0,
  },
];

const URGENT = [
  {
    id: 'gallery-failed',
    title: "Couldn't save the checklist",
    description: 'The server answered 503. Your changes are still here.',
    tone: 'crit',
  },
  {
    id: 'gallery-undo',
    title: 'Device removed',
    description: 'Pixel 8 no longer gets alerts.',
    action: { label: 'Undo', onClick: noop },
    timeout: 0,
  },
];

const BANNERS = [
  {
    tone: 'crit',
    title: 'Live metrics unavailable',
    cause: 'Prometheus unreachable at 192.168.68.11:9090',
    detail: 'Last good reading 3 min ago',
    action: 'Retry',
  },
  {
    tone: 'warn',
    title: 'Backups overdue',
    cause: "vzdump hasn't reported since 02:00",
    detail: 'Expected every 24 h',
    action: 'Open jobs',
  },
  {
    tone: 'unknown',
    title: 'No signal from Wiki.js',
    cause: 'Kuma has no heartbeat for this monitor yet',
    detail: 'Monitor added 2 min ago',
    action: 'Open Kuma',
  },
  {
    tone: 'maintenance',
    title: 'Planned work on vm-103',
    cause: 'Kuma maintenance until 10:00',
    detail: 'Alerts for its services are held',
    action: 'Details',
  },
  {
    tone: 'info',
    title: 'Demo mode',
    cause: 'Everything here is made-up data.',
    detail: 'Nothing is sent anywhere',
    action: 'Leave demo',
  },
  {
    tone: 'ok',
    title: 'Back to normal',
    cause: 'Prometheus answered again at 08:41',
    detail: 'Down for 6 min',
    action: 'Dismiss',
  },
];

function BannerState({ plain = false }) {
  return (
    <Stack gap={12} width={640}>
      {BANNERS.map((b) => (
        <Banner
          key={b.tone}
          tone={b.tone}
          title={b.title}
          cause={b.cause}
          detail={plain ? undefined : b.detail}
          action={plain ? undefined : <Button size="sm">{b.action}</Button>}
        />
      ))}
    </Stack>
  );
}

function EmptyStateState() {
  return (
    <Grid columns="repeat(2, 400px)">
      <Panel title="Integrations">
        <EmptyState
          icon={<Inbox />}
          title="No integrations yet"
          description="Add one to show its stats on the Overview and in the drawer."
          action={
            <Button variant="primary">
              <Plus />
              Add integration
            </Button>
          }
        />
      </Panel>
      <Panel title="Search">
        <EmptyState size="sm" title="Nothing matches “gitea”" />
      </Panel>
    </Grid>
  );
}

function SkeletonState() {
  return (
    <Stack width={400}>
      <Panel title="Services">
        <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span className="sr-only">Loading services</span>
          <Skeleton style={{ height: 12, width: '70%' }} />
          <Skeleton style={{ height: 12, width: '50%' }} />
          <Skeleton style={{ height: 12, width: '85%' }} />
          <Row>
            <Skeleton className="rounded-full" style={{ width: 32, height: 32 }} />
            <Skeleton className="rounded-full" style={{ width: 64, height: 20 }} />
          </Row>
          <Skeleton className="rounded-lg" style={{ height: 96 }} />
        </div>
      </Panel>
    </Stack>
  );
}

// ---------------------------------------------------------------- status

const LAMP_ROWS = [
  ['ok', 'ok'],
  ['warn', 'warn'],
  ['crit', 'crit'],
  ['unknown', 'unknown'],
  ['maintenance', 'maintenance'],
  ['healthy', 'healthy (an Android severity, read as ok)'],
  ['caution', 'caution (read as warn)'],
  ['critical', 'critical (read as crit)'],
  ['offline', 'anything else (read as no signal)'],
];

function Lamps() {
  return (
    <Grid columns="10px 14px 20px 1fr" gap={12}>
      {LAMP_ROWS.map(([state, said]) => (
        <LampRow key={state} state={state} said={said} />
      ))}
    </Grid>
  );
}

function LampRow({ state, said }) {
  return (
    <>
      <StatusLamp state={state} />
      <StatusLamp state={state} size="lg" />
      <StatusLamp state={state} size={20} />
      <Caption>{said}</Caption>
    </>
  );
}

function StatusLampState() {
  return (
    <Grid columns="repeat(2, 320px)">
      <Stack gap={8}>
        <Caption>On the page</Caption>
        <Lamps />
      </Stack>
      <Panel title="On a panel">
        <Lamps />
      </Panel>
    </Grid>
  );
}

const STATES = ['ok', 'warn', 'crit', 'unknown', 'maintenance'];

function StatusWordState() {
  return (
    <Stack>
      <Row gap={20}>
        {STATES.map((state) => (
          <StatusWord key={state} state={state} />
        ))}
      </Row>
      <Row gap={20}>
        <StatusWord state="crit" word="Down" />
        <StatusWord state="crit" word="On battery" />
        <StatusWord state="warn" word="Overdue" />
        <StatusWord state="unknown" word="UNKN" />
      </Row>
      <p>
        Immich is <StatusWord state="crit" word="down" /> and the UPS is{' '}
        <StatusWord state="crit" word="on battery" />.
      </p>
    </Stack>
  );
}

function StatusBadgeState() {
  return (
    <Stack>
      <Row>
        {STATES.map((state) => (
          <StatusBadge key={state} state={state} />
        ))}
      </Row>
      <Row>
        <StatusBadge state="crit" word="Down" />
        <StatusBadge state="crit" word="On battery" />
        <StatusBadge state="warn" word="Overdue" />
      </Row>
    </Stack>
  );
}

function IssueRows() {
  return (
    <List>
      {[...ISSUES, MAINTENANCE_ISSUE].map((issue) => (
        <li key={issue.id}>
          <IssueRow issue={issue} onOpen={issue.onOpen} href={issue.href} />
        </li>
      ))}
    </List>
  );
}

function IssueRowState({ width }) {
  return (
    <Stack width={width}>
      <Panel flush title="Issues">
        <IssueRows />
      </Panel>
    </Stack>
  );
}

function SubsystemStripState() {
  return <SubsystemStrip cells={CELLS} />;
}

// Several strips on one page each need their own name (axe: landmark-unique);
// a screen has one, named "Subsystems".
function SubsystemStripNarrowState() {
  return (
    <Stack>
      <Caption>700px: rows of three, each tile its value over its sub-line</Caption>
      <Stack width={700}>
        <SubsystemStrip cells={CELLS} aria-label="Subsystems at 700px" />
      </Stack>
      <Caption>480px: rows of three</Caption>
      <Stack width={480}>
        <SubsystemStrip cells={CELLS} aria-label="Subsystems at 480px" />
      </Stack>
      <Caption>300px: rows of two</Caption>
      <Stack width={300}>
        <SubsystemStrip cells={CELLS} aria-label="Subsystems at 300px" />
      </Stack>
    </Stack>
  );
}

function SubsystemStripCountsState() {
  return (
    <Stack>
      <SubsystemStrip cells={CELLS.slice(0, 4)} aria-label="Four subsystems" />
      <SubsystemStrip cells={CELLS.slice(0, 5)} aria-label="Five subsystems" />
      <Row align="start" gap={16}>
        <Stack width={300}>
          <SubsystemStrip cells={CELLS.slice(0, 4)} aria-label="Four subsystems at 300px" />
        </Stack>
        <Stack width={480}>
          <SubsystemStrip cells={CELLS.slice(0, 5)} aria-label="Five subsystems at 480px" />
        </Stack>
        <Stack width={300}>
          <SubsystemStrip cells={CELLS.slice(0, 5)} aria-label="Five subsystems at 300px" />
        </Stack>
      </Row>
    </Stack>
  );
}

function SubsystemStripSelectableState() {
  return <SubsystemStrip cells={CELLS} selected="services" onSelect={noop} />;
}

const ALL_ALERTS = (
  <a
    href="#alerts"
    className={cn(buttonVariants({ variant: 'ghost', size: 'sm', tone: 'accent' }))}
  >
    All alerts
  </a>
);

function AttentionPanelState() {
  return <AttentionPanel {...INCIDENT} action={ALL_ALERTS} issues={ISSUES} />;
}

function AttentionPanelFilteredState() {
  return (
    <AttentionPanel
      {...INCIDENT}
      action={ALL_ALERTS}
      issues={ISSUES.slice(0, 1)}
      filter="Services"
      onClearFilter={noop}
    />
  );
}

function AttentionPanelFilteredEmptyState() {
  return <AttentionPanel {...INCIDENT} issues={[]} filter="Jobs" onClearFilter={noop} />;
}

function AttentionPanelQuietState() {
  return <AttentionPanel state="ok" counts="32 services, 6 nodes" meta="Last incident 2 d ago" />;
}

// #298: the Overview's strip filtered on a quiet board.
function AttentionPanelQuietFilteredState() {
  return (
    <AttentionPanel
      state="ok"
      counts="All 12 services up · 3 nodes healthy"
      filter="Nodes"
      onClearFilter={noop}
    />
  );
}

function AttentionPanelMaintenanceState() {
  return (
    <AttentionPanel
      state="maintenance"
      counts="32 services, 6 nodes"
      meta="Maintenance until 10:00"
    />
  );
}

function AttentionPanelFirstRunState() {
  return <AttentionPanel state="empty" counts="Nothing monitored yet" />;
}

function AttentionPanelNarrowState() {
  return (
    <Stack width={390}>
      <AttentionPanel {...INCIDENT} action={ALL_ALERTS} issues={ISSUES} />
    </Stack>
  );
}

// #480: a stale status, as the shell draws it (src/shell/statusFreshness.js):
// every state no signal, the words, counts and sub-lines kept; the header
// says how old they are, once, not each tile (statusView.js subsystemCells, #541).
const stale = (items) => items.map((item) => ({ ...item, state: 'unknown' }));

function SubsystemStripNoSignalState() {
  return <SubsystemStrip cells={stale(CELLS)} />;
}

function AttentionPanelNoSignalState() {
  return (
    <AttentionPanel
      state="unknown"
      counts="last known 3 min ago: Critical · 2 critical, 1 warning, 1 no signal"
      subline="Can't reach JagHelm"
      action={ALL_ALERTS}
      issues={stale(ISSUES)}
    />
  );
}

// #484: below 768px the Overview draws the panel in two parts with the strip
// between them, as the Phone board orders it (status card, strip, issue
// list), at a phone's 390px; a quiet board keeps the strip under its line.
const SIX_ISSUES = [
  ...ISSUES.slice(0, 3),
  {
    id: 'b2',
    state: 'warn',
    word: 'Overdue',
    title: 'NAS → B2 backup',
    where: 'Backup · jagnas',
    reason: 'Last success 27 h ago',
    age: '3 h',
    onOpen: noop,
  },
  {
    id: 'nas',
    state: 'warn',
    word: 'Warning',
    title: 'JagNAS disk',
    where: 'Node · jagnas',
    reason: '92 % (warning above 90 %)',
    age: '3 h',
    onOpen: noop,
  },
  ISSUES[3],
];

const HEALTHY_CELLS = [
  ['services', 'Services', '32 / 32', 'up'],
  ['nodes', 'Nodes', '6 / 6', 'healthy'],
  ['power', 'Power', 'On mains', '100 % charge'],
  ['jobs', 'Jobs', '14 / 14', 'OK'],
  ['backups', 'Backups', '3 / 3', 'OK'],
  ['integrations', 'Integrations', '12 / 12', 'OK'],
].map(([key, label, value, sub]) => ({ key, label, state: 'ok', value, sub }));

function AttentionPanelPhoneState() {
  return (
    <Stack width={390}>
      {/* The word alone, as the phone's Overview gives it (#303). */}
      <AttentionPanel
        state="crit"
        subline={INCIDENT.subline}
        meta="Updated 12 s ago"
        issues={SIX_ISSUES}
        between={<SubsystemStrip cells={CELLS} onSelect={noop} />}
        split
      />
    </Stack>
  );
}

// The quiet line has no rows to split: the strip follows it, 24px down, as
// the Overview's ShellSection stacks them.
function AttentionPanelPhoneQuietState() {
  return (
    <Stack width={390} gap={24}>
      <AttentionPanel
        state="ok"
        counts="All 32 services up · 6 nodes healthy"
        between={<SubsystemStrip cells={HEALTHY_CELLS} onSelect={noop} />}
        split
      />
    </Stack>
  );
}

function AttentionPanelPhoneNoSignalState() {
  return (
    <Stack width={390}>
      {/* As the phone's Overview orders it: "No signal", why, what it last knew. */}
      <AttentionPanel
        state="unknown"
        subline="Can't reach JagHelm"
        meta="last known 3 min ago: Critical · 2 critical, 3 warnings, 1 no signal"
        issues={stale(SIX_ISSUES)}
        between={<SubsystemStrip cells={stale(CELLS)} onSelect={noop} />}
        split
      />
    </Stack>
  );
}

// ---------------------------------------------------------------- data

function MetricMeterState() {
  return (
    <Stack width={520}>
      <Panel title="vm-103" description="Production" icon={<LayoutGrid />}>
        <Grid columns="repeat(2, minmax(0, 1fr))" gap={16}>
          <MetricMeter label="CPU" value={34} warn={75} crit={90} />
          <MetricMeter label="Memory" value={78} warn={75} crit={90} />
          <MetricMeter label="Disk /" value={92} warn={75} crit={90} />
          <MetricMeter label="Load" value={130} warn={75} crit={90} />
          <MetricMeter label="Temperature" value={78} max={100} unit="°C" warn={75} crit={85} />
          <MetricMeter
            label="Swap, held by the server"
            value={82}
            warn={85}
            crit={95}
            state="warn"
          />
          <MetricMeter label="Disk /data, crit only" value={40} crit={90} />
          <MetricMeter label="GPU" value={null} warn={75} crit={90} />
        </Grid>
      </Panel>
    </Stack>
  );
}

function SparklineState() {
  return (
    <Stack width={560}>
      <Panel title="Trends" description="08:00 to 08:58">
        <Grid columns="160px 1fr" gap={14}>
          <Caption>Line, 0–100</Caption>
          <Sparkline label="CPU, last hour" points={CPU} unit="%" />
          <Caption>Area</Caption>
          <Sparkline label="Memory, last hour" points={MEMORY} unit="%" area />
          <Caption>Auto domain</Caption>
          <Sparkline label="Latency, last hour" points={LATENCY} domain="auto" unit=" ms" />
          <Caption>A gap</Caption>
          <Sparkline label="CPU with missing readings" points={GAPPED} unit="%" />
          <Caption>One reading: nothing</Caption>
          <Sparkline label="CPU, one reading" points={CPU.slice(0, 1)} unit="%" />
          <Caption>Full width, 48px</Caption>
          <Sparkline
            label="Memory, full width"
            points={MEMORY}
            unit="%"
            area
            height={48}
            className="w-full"
          />
        </Grid>
      </Panel>
    </Stack>
  );
}

function SparklineTooltipState() {
  return (
    <Stack width={360}>
      <Panel title="Memory" description="Last hour">
        <Sparkline
          label="Memory, last hour"
          points={MEMORY}
          unit="%"
          area
          height={48}
          className="w-full"
        />
      </Panel>
    </Stack>
  );
}

// ---------------------------------------------------------------- charts (#311)

// The last hour, 08:00 to 09:00 UTC on 2026-10-20, a reading a minute: made
// up, repeatable, a gentle swell with a little ripple.
const hour = (base, swing, phase) =>
  Array.from({ length: 61 }, (_, i) => ({
    time: T0 + i * 60_000,
    value:
      Math.round(
        (base + swing * Math.sin(i / 9 + phase) + (swing / 3) * Math.sin(i * 1.7 + phase * 3)) * 10
      ) / 10,
  }));
const pct = (v) => `${Math.floor(v)} %`;
const degrees = (v) => `${Math.floor(v)} °C`;
const HOUR_CHART = {
  tickEvery: 15 * 60_000,
  formatTick: (t) => new Date(t).toISOString().slice(11, 16),
  formatTime: (t) => new Date(t).toISOString().slice(11, 16),
};
const CHART_CPU = [{ key: 'cpu', name: 'CPU', points: hour(24, 8, 0) }];
const CHART_TEMP = [{ key: 'temp', name: 'Temperature', points: hour(46, 2.5, 1) }];
const CHART_GAP = [
  {
    key: 'cpu',
    name: 'CPU',
    points: hour(24, 8, 0).map((p, i) => (i > 24 && i < 33 ? { ...p, value: null } : p)),
  },
];
const CHART_USAGE = [
  { key: 'cpu', name: 'CPU', points: hour(24, 8, 0) },
  { key: 'memory', name: 'Memory', points: hour(62, 2, 2) },
  { key: 'disk', name: 'Disk', points: hour(48, 0.3, 4) },
];
// CPU by node, the chart Jag's rule is for: six series, so slots 4 to 6 dashed.
const CHART_NODES = [
  ['edge', 'Network Edge', 8, 3],
  ['apps', 'App Server', 34, 9],
  ['storage', 'Storage', 18, 5],
  ['media', 'Media', 52, 10],
  ['backup', 'Backup', 12, 6],
  ['lab', 'Lab', 70, 8],
].map(([key, name, base, swing], i) => ({ key, name, points: hour(base, swing, i * 1.3) }));

// ---------------------------------------------------------------- bar charts (#748)

const dayLabel = (t) => new Date(t).toISOString().slice(5, 10);
const days = (v) => `${Math.floor(v)} days`;
const money = (v) => `$${v.toFixed(2)}`;
const gigabytes = (v) => `+${(v / 1e9).toFixed(1)} GB`;
// A week of a container's memory, one reading a day: made up, repeatable.
const trend = (start, step) =>
  Array.from({ length: 8 }, (_, i) => ({
    time: T0 - (7 - i) * 86_400_000,
    value: start + step * i + (i % 3) * step * 0.4,
  }));
const RUNWAY = [
  { key: 'nas', name: 'JagNAS volume 1', value: 9, state: 'crit', points: trend(80, -4) },
  { key: 'pve', name: 'pve local-lvm', value: 38, state: 'warn', points: trend(60, -1.5) },
  { key: 'vm103', name: 'vm-103 rootfs', value: 143, points: trend(40, -0.3) },
  { key: 'pi1', name: 'pi-1 SD card', value: 420, points: trend(30, -0.1) },
];
const GROWERS = [
  { key: 'loki', name: 'loki', value: 2.4e9, points: trend(0.4, 0.28), valueText: '+2.4 GB' },
  {
    key: 'immich',
    name: 'immich-server',
    value: 1.1e9,
    points: trend(0.2, 0.13),
    valueText: '+1.1 GB',
  },
  { key: 'grafana', name: 'grafana', value: 0.3e9, points: trend(0.1, 0.03), valueText: '+0.3 GB' },
  { key: 'npm', name: 'nginx-proxy-manager', value: null },
];
// Two weeks of cost, the last day not over; the rate rose on the 18th.
const COST = Array.from({ length: 14 }, (_, i) => {
  const time = Date.UTC(2026, 9, 7 + i);
  return {
    key: `d${i}`,
    time,
    value: i === 5 ? null : 2.1 + 0.5 * Math.sin(i / 2) + (i % 4) * 0.08,
    note: i < 11 ? 'Rate $0.14/kWh' : 'Rate $0.16/kWh (from 17 Oct)',
  };
});
const COST_PARTIAL = COST.map((d, i) => (i === 13 ? { ...d, value: 0.94 } : d));
const dayLong = (t) => new Date(t).toISOString().slice(0, 10);

function RankedBarsState() {
  return (
    <Stack width={520}>
      <Panel title="Which disk fills first?" description="Days left at the current rate">
        <Stack gap={14}>
          <Caption>Flagged: a lamp on the rows that need attention, a trend on each</Caption>
          <RankedBars label="Days until full" rows={RUNWAY} formatValue={days} />
          <Caption>Healthy: no lamps</Caption>
          <RankedBars
            label="Days until full, all well"
            rows={RUNWAY.slice(2).map(({ state: _state, ...r }) => r)}
            formatValue={days}
          />
          <Caption>Container growers: value text, a gap, no data</Caption>
          <RankedBars label="Memory growth, 7 days" rows={GROWERS} formatValue={gigabytes} />
          <Caption>Prometheus not answering</Caption>
          <RankedBars
            label="Days until full"
            rows={[]}
            state="failed"
            detail="Prometheus didn't answer"
          />
          <Caption>Loading</Caption>
          <RankedBars label="Days until full" rows={[]} state="loading" />
          <Caption>Nothing to rank</Caption>
          <RankedBars label="Memory growth, 7 days" rows={[]} />
        </Stack>
      </Panel>
    </Stack>
  );
}

function RankedBarsKeyboardState() {
  return (
    <Stack width={520}>
      <Panel title="Which disk fills first?" description="Days left at the current rate">
        <RankedBars label="Days until full" rows={RUNWAY} formatValue={days} />
      </Panel>
    </Stack>
  );
}

function DailyBarsState() {
  const common = { formatValue: money, formatTick: dayLabel, formatDay: dayLong, height: 96 };
  return (
    <Stack width={560}>
      <Panel title="What does it cost?" description="Per day">
        <Stack gap={14}>
          <Caption>A fortnight, a day with no data</Caption>
          <DailyBars label="Cost per day" days={COST} {...common} />
          <Caption>The last day isn&apos;t over: lighter, dashed, &quot;so far&quot;</Caption>
          <DailyBars label="Cost per day, today so far" days={COST_PARTIAL} partial {...common} />
          <Caption>Prometheus not answering</Caption>
          <DailyBars
            label="Cost per day"
            days={[]}
            state="failed"
            detail="Prometheus didn't answer"
            height={72}
          />
          <Caption>No days</Caption>
          <DailyBars label="Cost per day" days={[]} height={72} />
          <Caption>Loading</Caption>
          <DailyBars label="Cost per day" days={[]} state="loading" height={72} />
        </Stack>
      </Panel>
    </Stack>
  );
}

function DailyBarsTooltipState() {
  return (
    <Stack width={560}>
      <Panel title="What does it cost?" description="Per day">
        <DailyBars
          label="Cost per day, today so far"
          days={COST_PARTIAL}
          partial
          formatValue={money}
          formatTick={dayLabel}
          formatDay={dayLong}
          height={128}
        />
      </Panel>
    </Stack>
  );
}

function ChartState() {
  return (
    <Stack width={520}>
      <Panel title="History" description="08:00 to 09:00">
        <Stack gap={14}>
          <Caption>One series on 0–100 %</Caption>
          <Chart
            label="CPU, last hour"
            series={CHART_CPU}
            formatValue={pct}
            height={72}
            {...HOUR_CHART}
          />
          <Caption>Fitted to its readings</Caption>
          <Chart
            label="Temperature, last hour"
            series={CHART_TEMP}
            domain="auto"
            formatValue={degrees}
            height={72}
            {...HOUR_CHART}
          />
          <Caption>A gap: the line breaks</Caption>
          <Chart
            label="CPU with missing readings"
            series={CHART_GAP}
            formatValue={pct}
            height={72}
            {...HOUR_CHART}
          />
          <Caption>Prometheus not answering</Caption>
          <Chart
            label="Memory, last hour"
            series={[]}
            state="failed"
            detail="Prometheus didn't answer"
            height={72}
          />
          <Caption>No readings in the range</Caption>
          <Chart label="Disk, last hour" series={[]} height={72} />
          <Caption>Loading</Caption>
          <Chart label="Disk, last 7 days" series={[]} state="loading" height={72} />
        </Stack>
      </Panel>
    </Stack>
  );
}

function StatTileState() {
  return (
    <Stack width={420}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <StatTile label="Month to date" value="$6.10" note="so far" />
        <StatTile label="Projected month" value="$10.24" note="at $0.16/kWh, from the last 7 days" />
        <StatTile label="UPS runtime" value={null} note="at the current load" />
        <StatTile label="Projected month" value={null} emptyText="Not enough days yet" />
      </div>
    </Stack>
  );
}

// The Monitoring page's power charts (#753) from fixed answers (the server's
// shape, server/monitoring.js), with the ticks written in UTC so every render
// is the same. Hand-made here: the demo fixtures are the server's to import.
const MON_END = Date.UTC(2026, 9, 29, 12, 0, 0);
const monWatts = (count, i) => Math.round((90 + 5 * Math.sin(i / 9) + 2 * Math.sin(i / 2.3)) * 10) / 10;
function monPower(range) {
  const long = range === '30d';
  const [count, stepMs] = long ? [361, 7_200_000] : [289, 300_000];
  const values = Array.from({ length: count }, (_, i) => monWatts(count, i));
  const maxValues = long ? values.map((v, i) => Math.round((v + 5 + 3 * Math.abs(Math.sin(i * 1.7))) * 10) / 10) : null;
  return {
    id: 'power-draw',
    title: 'Power draw',
    question: 'What does the lab draw?',
    section: 'power-cost',
    ok: true,
    state: 'ok',
    unit: 'W',
    startMs: MON_END - (count - 1) * stepMs,
    stepMs,
    count,
    values,
    maxValues,
    stats: { minWatts: Math.min(...values), maxWatts: Math.max(...(maxValues ?? values)), avgWatts: 90 },
    ...(long ? {} : { runtimeMinutes: 41 }),
  };
}
function monCost() {
  const days = Array.from({ length: 30 }, (_, n) => {
    const startMs = Date.UTC(2026, 9, 29) - (29 - n) * 86_400_000;
    const day = new Date(startMs).toISOString().slice(0, 10);
    const partial = n === 29;
    const kWh = Math.round((2.15 + 0.12 * Math.sin(n) - (partial ? 1.1 : 0)) * 1000) / 1000;
    const ratePerKwh = day >= '2026-10-17' ? 0.16 : 0.14;
    return { day, startMs, kWh, cost: Math.round(kWh * ratePerKwh * 10_000) / 10_000, ratePerKwh, coverage: 1, partial };
  });
  return {
    id: 'monthly-cost',
    title: 'Monthly cost',
    question: 'What does it cost?',
    section: 'power-cost',
    ok: true,
    state: 'ok',
    zone: 'UTC',
    currency: '$',
    currentRatePerKwh: 0.16,
    throughMs: MON_END,
    days,
    month: {
      month: '2026-10',
      since: null,
      daysLeft: 2.5,
      kWh: 63.1,
      cost: 9.64,
      projected: { kWh: 68.6, cost: 10.52, basisDays: 7, meanDailyKWh: 2.2 },
    },
  };
}
const monChart = (id, range = '24h') => (id === 'power-draw' ? monPower(range) : monCost());
// The page's own ticks, as drawn on a phone-free desktop (the gallery's browser clock is fixed).
const monRange = (value) => monitoringRangeOf(value);
const monFailed = (chart, error) => ({
  id: chart.id,
  title: chart.title,
  question: chart.question,
  section: chart.section,
  ok: false,
  error,
});

// The CPU small multiples (#756): five nodes. Media is past the warn line now,
// Lab answered nothing (off), Edge has no temperature sensor.
const MON_NODES = ['edge', 'apps', 'storage', 'media', 'lab'];
function monCpu(range) {
  const long = range === '30d' || range === '7d';
  const [count, stepMs] =
    range === '30d' ? [361, 7_200_000] : range === '7d' ? [337, 1_800_000] : [61, 60_000];
  const line = (entity, base, swing, phase, last) => ({
    entity,
    values: Array.from({ length: count }, (_, i) => {
      const v = base + swing * Math.sin(i / 7 + phase) + (swing / 2) * Math.sin(i / 2.3 + phase);
      if (entity === 'apps' && i >= 20 && i < 24) return null;
      return Math.round((i === count - 1 && last != null ? last : v) * 10) / 10;
    }),
  });
  const peak = (lines, over) =>
    lines.map(({ entity, values }) => ({
      entity,
      values: values.map((v, i) =>
        v == null ? null : Math.round((v + over * (1 + Math.abs(Math.sin(i * 1.7)))) * 10) / 10
      ),
    }));
  const cpu = [
    line('edge', 9, 3, 0),
    line('apps', 34, 9, 1),
    line('storage', 18, 5, 2),
    line('media', 70, 14, 3, 93),
  ];
  const iowait = [
    line('edge', 1, 0.6, 4),
    line('apps', 3, 1.5, 5),
    line('storage', 6, 2, 6),
    line('media', 2, 1, 7),
  ];
  const temp = [line('apps', 52, 4, 8), line('storage', 61, 5, 9), line('media', 70, 5, 10, 78)];
  const part = (unit, lines, over) => ({
    ok: true,
    unit,
    lines,
    ...(long && { maxLines: peak(lines, over) }),
  });
  return {
    id: 'cpu-overview',
    title: 'CPU by node',
    question: "Is a node's CPU off?",
    section: 'resources',
    ok: true,
    unit: '%',
    startMs: MON_END - (count - 1) * stepMs,
    stepMs,
    count,
    nodes: MON_NODES,
    lines: cpu,
    ...(long && { maxLines: peak(cpu, 4) }),
    thresholds: { cpu: { warn: 90 }, temp: { warn: 75, crit: 85 } },
    iowait: part('%', iowait, 1.5),
    temperature: part('°C', temp, 2),
  };
}

function MonitoringCpuState() {
  const hourly = monCpu('1h');
  const panel = (chart, title, range = '1h', focus) => (
    <ChartPanel chart={{ ...chart, title }} range={monRange(range)} busy={false} focus={focus} />
  );
  return (
    <Stack width={640}>
      <MonitoringSection
        title="Resources"
        question="Is any node short of CPU, memory or bandwidth?"
      >
        <Caption>
          1 h: a cell per node on one scale, the warn line, Media past it, Apps with a gap, Lab off
        </Caption>
        {panel(hourly, 'CPU by node')}
        <Caption>30 d: the highest reading in each step behind each line</Caption>
        {panel(monCpu('30d'), 'CPU by node, 30 days', '30d')}
        <Caption>Pointed at from the banner&apos;s View graph: the selected ring and tag</Caption>
        {panel(hourly, 'CPU by node, pointed at', '1h', {
          node: 'media',
          text: 'Warning · 93 % CPU',
        })}
        <Caption>No node is set up</Caption>
        {panel({ ...hourly, nodes: [], lines: [] }, 'CPU by node, no nodes')}
        <Caption>Prometheus failing</Caption>
        {panel(
          monFailed(hourly, 'Prometheus refused the CPU query (HTTP 400)'),
          'CPU by node, failing'
        )}
      </MonitoringSection>
    </Stack>
  );
}

// The drill-down open on Media's temperature issue: I/O wait, and the temperature with
// both lines and the max band.
function MonitoringCpuDrillState() {
  return (
    <Stack width={640}>
      <ChartPanel
        chart={monCpu('7d')}
        range={monRange('7d')}
        busy={false}
        focus={{ node: 'media', text: 'Warning · 78 °C', drill: true }}
      />
    </Stack>
  );
}

function MonitoringCpuDrillPartsState() {
  const chart = monCpu('24h');
  // Edge has no sensor, and the I/O wait read failed.
  return (
    <Stack width={640}>
      <ChartPanel
        chart={{
          ...chart,
          iowait: { ok: false, error: 'Prometheus refused the I/O wait query (HTTP 400)' },
        }}
        range={monRange('24h')}
        busy={false}
        focus={{ node: 'edge', drill: true }}
      />
    </Stack>
  );
}

function MonitoringPowerDrawState() {
  const day = monChart('power-draw');
  const month = monChart('power-draw', '30d');
  // Each panel is a landmark named by its title, so each title here is its own.
  const panel = (chart, title, range = '24h') => (
    <ChartPanel chart={{ ...chart, title }} range={monRange(range)} busy={false} />
  );
  return (
    <Stack width={560}>
      <MonitoringSection title="Power and cost" question="What does the lab draw, and what does it cost?">
        <Caption>24 h: runtime tile, lowest and highest, the footnote</Caption>
        {panel(day, 'Power draw')}
        <Caption>30 d: the max band behind the line</Caption>
        {panel(month, 'Power draw, 30 days', '30d')}
        <Caption>The UPS gave no runtime reading</Caption>
        {panel({ ...day, runtimeMinutes: null }, 'Power draw, no runtime')}
        <Caption>No UPS data: words, no line at 0 W</Caption>
        {panel(
          { ...day, state: 'no-ups', values: [], maxValues: null, stats: null, runtimeMinutes: null },
          'Power draw, no UPS'
        )}
        <Caption>Prometheus failing</Caption>
        {panel(monFailed(day, 'Prometheus refused the connection'), 'Power draw, failing')}
      </MonitoringSection>
    </Stack>
  );
}

// The Monitoring page's Drives chart (#762) from fixed answers (the server's
// shape, monitoringDrives.js), in the states the page draws.
function monDrives() {
  const [count, stepMs] = [289, 300_000];
  const temp = (base, i) => Math.round((base + 1.5 * Math.sin(i / 11)) * 10) / 10;
  const drive = (device, type, base, over = {}) => ({
    key: `drive:storage:${device}`,
    device,
    model: type === 'nvme' ? 'CT1000P310SSD8' : 'ST8000VN004',
    type,
    state: 'ok',
    word: 'Healthy',
    reason: 'Healthy',
    temperature: base,
    lines: type === 'nvme' ? { warn: 70, crit: 80 } : { warn: 55, crit: 60 },
    values: Array.from({ length: count }, (_, i) => temp(base, i)),
    ...over,
  });
  return {
    id: 'drives',
    title: 'Drive health',
    question: 'Are the drives healthy?',
    section: 'drives',
    ok: true,
    unit: '°C',
    startMs: MON_END - (count - 1) * stepMs,
    stepMs,
    count,
    smart: 'ok',
    nodes: [
      {
        key: 'storage',
        name: 'NAS',
        blind: null,
        readingSeconds: 3600,
        drives: [
          drive('nvme0', 'nvme', 34),
          drive('sda', 'hdd', 41),
          drive('sdb', 'hdd', 43),
          drive('sdc', 'hdd', 40),
        ],
        raid: [
          { device: 'md0', active: 3, required: 3, failed: 0, spare: 0, state: 'ok', word: 'Healthy', reason: 'All 3 members active' },
        ],
      },
    ],
  };
}

function MonitoringDrivesState() {
  const ok = monDrives();
  const panel = (chart, title) => (
    <ChartPanel chart={{ ...chart, title }} range={monRange('24h')} busy={false} />
  );
  const [nas] = ok.nodes;
  const sick = {
    ...ok,
    nodes: [
      {
        ...nas,
        name: 'NAS 2',
        drives: [
          nas.drives[0],
          {
            ...nas.drives[1],
            state: 'crit',
            word: 'Critical',
            reason: 'drive sda failed its health check',
            temperature: 58,
            values: nas.drives[1].values.map((v, i) => (i > 200 ? v + 17 : v)),
          },
          { ...nas.drives[2], state: 'warn', word: 'Warning', reason: 'drive sdb has 3 reallocated sectors (grew in the last 7 days)' },
          nas.drives[3],
        ],
        raid: [
          { device: 'md0', active: 2, required: 3, failed: 1, spare: 0, state: 'crit', word: 'Critical', reason: 'degraded: 2 of 3 members active, 1 member missing' },
        ],
      },
    ],
  };
  return (
    <Stack width={560}>
      <MonitoringSection title="Drives" question="Are the drives healthy?">
        <Caption>Healthy: lamps, table, temperature under each kind&apos;s lines, a whole array</Caption>
        {panel(ok, 'Drive health')}
        <Caption>A failed drive, a growing sector count and a degraded array</Caption>
        {panel(sick, 'Drive health, unhealthy')}
        <Caption>A node that can no longer see its drives: no signal, no lamps</Caption>
        {panel({ ...ok, nodes: [{ ...nas, name: 'NAS 3', blind: 'Drive monitoring has no signal on NAS 3', drives: [], raid: [] }] }, 'Drive health, no signal')}
        <Caption>Drives with no temperature history in the range</Caption>
        {panel({ ...ok, nodes: [{ ...nas, name: 'NAS 4', drives: nas.drives.map((d) => ({ ...d, values: null })), raid: [] }] }, 'Drive health, no history')}
        <Caption>No smartctl exporter on any node</Caption>
        {panel({ ...ok, smart: 'none', nodes: [] }, 'Drive health, none')}
        <Caption>Module off</Caption>
        {panel({ ...ok, smart: 'off', nodes: [] }, 'Drive health, off')}
        <Caption>Prometheus failing</Caption>
        {panel(monFailed(ok, 'Prometheus refused the drive query (HTTP 400)'), 'Drive health, failing')}
      </MonitoringSection>
    </Stack>
  );
}

// The memory small multiples (#757): edge has no swap, apps swaps a little, media is
// past the warn line and swapping, lab answered nothing (off).
const MON_MEM_NODES = ['edge', 'apps', 'storage', 'media', 'lab'];
function monMemory(range) {
  const [count, stepMs] =
    range === '30d' ? [361, 7_200_000] : range === '7d' ? [337, 1_800_000] : [61, 60_000];
  const line = (entity, base, swing, phase, last) => ({
    entity,
    values: Array.from({ length: count }, (_, i) => {
      const v = base + swing * Math.sin(i / 9 + phase) + (swing / 2) * Math.sin(i / 2.7 + phase);
      if (entity === 'apps' && i >= 20 && i < 24) return null;
      return Math.round((i === count - 1 && last != null ? last : v) * 10) / 10;
    }),
  });
  return {
    id: 'memory',
    title: 'Memory and swap by node',
    question: 'Is memory or swap under strain?',
    section: 'resources',
    ok: true,
    unit: '%',
    startMs: MON_END - (count - 1) * stepMs,
    stepMs,
    count,
    nodes: MON_MEM_NODES,
    lines: [
      line('edge', 24, 3, 0),
      line('apps', 58, 6, 1),
      line('storage', 41, 4, 2),
      line('media', 80, 7, 3, 93),
    ],
    thresholds: { mem: { warn: 90 } },
    swap: {
      ok: true,
      unit: '%',
      lines: [line('apps', 12, 2, 4), line('storage', 3, 1, 5), line('media', 38, 8, 6, 52)],
    },
  };
}

function MonitoringMemoryState() {
  const hourly = monMemory('1h');
  const panel = (chart, title, range = '1h', focus) => (
    <ChartPanel chart={{ ...chart, title }} range={monRange(range)} busy={false} focus={focus} />
  );
  return (
    <Stack width={640}>
      <MonitoringSection title="Resources" question="Is any node short of CPU, memory or bandwidth?">
        <Caption>
          1 h: memory and swap per node, the warn line, Media past it, Edge with no swap, Apps with a
          gap, Lab off
        </Caption>
        {panel(hourly, 'Memory and swap by node')}
        <Caption>30 d</Caption>
        {panel(monMemory('30d'), 'Memory and swap by node, 30 days', '30d')}
        <Caption>Pointed at from the banner&apos;s View graph: the selected ring and tag</Caption>
        {panel(hourly, 'Memory and swap by node, pointed at', '1h', {
          node: 'media',
          text: 'Warning · 93 % memory',
        })}
        <Caption>The swap read failed: its sentence, and the memory lines stay</Caption>
        {panel(
          { ...hourly, swap: { ok: false, error: 'Prometheus refused the swap query (HTTP 400)' } },
          'Memory and swap by node, swap failing'
        )}
        <Caption>No node is set up</Caption>
        {panel({ ...hourly, nodes: [], lines: [] }, 'Memory and swap by node, no nodes')}
        <Caption>Prometheus failing</Caption>
        {panel(
          monFailed(hourly, 'Prometheus refused the memory query (HTTP 400)'),
          'Memory and swap by node, failing'
        )}
      </MonitoringSection>
    </Stack>
  );
}

// The phone's Monitoring page (#755) at 390px, from the same fixtures: the title
// and the 44px range switch, then the sections' Panels with their phone Bodies
// (list rows for CPU), and a chart with no phone drawing said in words.
function MonitoringPhoneState() {
  const range = monRange('24h');
  const panel = (chart, title, focus) => (
    <PhoneChartPanel chart={{ ...chart, title }} range={range} busy={false} focus={focus} />
  );
  const cpu = monCpu('24h');
  return (
    <Stack width={390} gap={16}>
      <div style={{ padding: '0 16px' }}>
        <Stack gap={12}>
          <h1 className="text-title">Monitoring</h1>
          <SegmentedControl
            aria-label="Range"
            size="touch"
            options={[
              { value: '1h', label: '1 h' },
              { value: '24h', label: '24 h' },
              { value: '7d', label: '7 d' },
              { value: '30d', label: '30 d' },
            ]}
            value="24h"
            onValueChange={noop}
          />
        </Stack>
      </div>
      <div style={{ padding: '0 16px' }}>
        <Stack gap={24}>
          <MonitoringSection title="Power and cost" question="What does the lab draw, and what does it cost?">
            {panel(monPower('24h'), 'Power draw')}
            {panel(monCost(), 'Monthly cost')}
          </MonitoringSection>
          <MonitoringSection title="Capacity" question="Which disk fills first?">
            {panel(
              monRunway([
                monDisk('storage', '/volume1', 'ok', 2.5, 20, 11500, 11450),
                monDisk('pve', '/', 'ok', 9, 1.5, 240, 226),
                monDisk('edge', '/', 'stable', null, 0, 128, 41),
              ]),
              'Disk runway'
            )}
          </MonitoringSection>
          <MonitoringSection title="Resources" question="Is any node short of CPU, memory or bandwidth?">
            {panel(cpu, 'CPU by node')}
            {panel(monMemory('24h'), 'Memory and swap by node')}
            {panel(monNetwork(), 'Network')}
          </MonitoringSection>
        </Stack>
      </div>
    </Stack>
  );
}

// The phone's chart states: pointed at from the banner's View graph (the selected
// ring and tag), a failed read and no nodes.
function MonitoringPhoneStatesState() {
  const range = monRange('24h');
  const cpu = monCpu('24h');
  const panel = (chart, title, focus) => (
    <PhoneChartPanel chart={{ ...chart, title }} range={range} busy={false} focus={focus} />
  );
  return (
    <Stack width={390} gap={16}>
      <div style={{ padding: '0 16px' }}>
        <MonitoringSection title="Resources" question="Is any node short of CPU, memory or bandwidth?">
          <Caption>Pointed at: the selected ring and tag on the row</Caption>
          {panel(cpu, 'CPU by node, pointed at', { node: 'media', text: 'Warning · 93 % CPU' })}
          <Caption>Prometheus failing</Caption>
          {panel(monFailed(cpu, 'Prometheus refused the CPU query (HTTP 400)'), 'CPU by node, failing')}
          <Caption>No node is set up</Caption>
          {panel({ ...cpu, nodes: [], lines: [] }, 'CPU by node, no nodes')}
        </MonitoringSection>
      </div>
    </Stack>
  );
}

// The phone's Resources charts (#759) at 390px: memory rows with swap said under
// the figure (a node with none, the pointed-at ring, a failed swap read), the
// 7 d form, and the network chart with its node picker and a legend with no
// end labels.
function MonitoringPhoneResourcesState() {
  const mem = monMemory('24h');
  const panel = (chart, title, range = '24h', focus) => (
    <PhoneChartPanel chart={{ ...chart, title }} range={monRange(range)} busy={false} focus={focus} />
  );
  return (
    <Stack width={390} gap={16}>
      <div style={{ padding: '0 16px' }}>
        <MonitoringSection title="Resources" question="Is any node short of CPU, memory or bandwidth?">
          <Caption>Memory rows: swap in words (Edge has none, Lab is off), Media past the warn line</Caption>
          {panel(mem, 'Memory and swap by node')}
          <Caption>Pointed at from the banner</Caption>
          {panel(mem, 'Memory and swap by node, pointed at', '24h', {
            node: 'media',
            text: 'Warning · 93 % memory',
          })}
          <Caption>The swap read failed</Caption>
          {panel(
            { ...mem, swap: { ok: false, error: 'Prometheus refused the swap query (HTTP 400)' } },
            'Memory and swap by node, swap failing'
          )}
          <Caption>Prometheus failing</Caption>
          {panel(monFailed(mem, 'Prometheus refused the memory query (HTTP 400)'), 'Memory and swap by node, failing')}
          <Caption>Network</Caption>
          {panel(monNetwork(), 'Network')}
        </MonitoringSection>
      </div>
    </Stack>
  );
}

function MonitoringMonthlyCostState() {
  const cost = monChart('monthly-cost');
  const panel = (chart, title) => (
    <ChartPanel chart={{ ...chart, title }} range={monRange('24h')} busy={false} />
  );
  return (
    <Stack width={560}>
      <MonitoringSection title="Power and cost" question="What does the lab draw, and what does it cost?">
        <Caption>Two rates in the month; today lighter and &quot;so far&quot;</Caption>
        {panel(cost, 'Monthly cost')}
        <Caption>The month began before Prometheus&apos;s 30 days did</Caption>
        {panel({ ...cost, month: { ...cost.month, since: '2026-10-02' } }, 'Monthly cost, since the 2nd')}
        <Caption>No rate set: kWh, and the way to set one</Caption>
        {panel(
          {
            ...cost,
            currency: null,
            currentRatePerKwh: null,
            days: cost.days.map((d) => ({ ...d, cost: null, ratePerKwh: null })),
            month: { ...cost.month, cost: null, projected: { ...cost.month.projected, cost: null } },
          },
          'Monthly cost, no rate'
        )}
        <Caption>Too few days for a projection</Caption>
        {panel({ ...cost, month: { ...cost.month, projected: null } }, 'Monthly cost, no projection')}
        <Caption>No UPS data</Caption>
        {panel({ ...cost, state: 'no-ups', days: undefined, month: undefined }, 'Monthly cost, no UPS')}
        <Caption>Prometheus failing</Caption>
        {panel(monFailed(cost, 'Prometheus refused the connection'), 'Monthly cost, failing')}
      </MonitoringSection>
    </Stack>
  );
}

// The Monitoring page's Network chart (#758), from a fixed answer: two nodes, in and out.
function monNetwork() {
  const count = 289;
  const stepMs = 300_000;
  const line = (base, phase) =>
    Array.from({ length: count }, (_, i) =>
      Math.round(base * (1 + 0.5 * Math.sin(i / 11 + phase) + 0.2 * Math.sin(i / 3.1 + 2 * phase)))
    );
  return {
    id: 'network',
    title: 'Network',
    question: 'Is traffic normal?',
    section: 'resources',
    ok: true,
    unit: 'B/s',
    startMs: MON_END - (count - 1) * stepMs,
    stepMs,
    count,
    nodes: [
      { entity: 'edge', rx: line(310_000, 0), tx: line(120_000, 1.3) },
      { entity: 'apps', rx: line(2_400_000, 2), tx: line(900_000, 0.4) },
    ],
  };
}

function MonitoringNetworkState() {
  const net = monNetwork();
  const panel = (chart, title) => (
    <ChartPanel chart={{ ...chart, title }} range={monRange('24h')} busy={false} />
  );
  return (
    <Stack width={560}>
      <MonitoringSection title="Resources" question="Is any node short of CPU, memory or bandwidth?">
        <Caption>In above the line, out below, one node at a time</Caption>
        {panel(net, 'Network')}
        <Caption>A gap in the readings breaks the area</Caption>
        {panel(
          {
            ...net,
            nodes: [
              {
                ...net.nodes[0],
                tx: net.nodes[0].tx.map((v, i) => (i > 100 && i < 160 ? null : v)),
                rx: net.nodes[0].rx.map((v, i) => (i > 100 && i < 160 ? null : v)),
              },
            ],
          },
          'Network, a gap'
        )}
        <Caption>No node has a reading</Caption>
        {panel({ ...net, nodes: [] }, 'Network, no readings')}
        <Caption>Prometheus failing</Caption>
        {panel(monFailed(net, 'Prometheus refused the connection'), 'Network, failing')}
      </MonitoringSection>
    </Stack>
  );
}

// The Disk runway chart (#754) from a fixed answer (the server's shape,
// diskRunwayOf in server/monitoring.js).
function monRunway(rows) {
  return {
    id: 'disk-runway',
    title: 'Disk runway',
    question: 'Which disk fills first?',
    section: 'capacity',
    ok: true,
    state: 'ok',
    computedAt: new Date(MON_END).toISOString(),
    windowDays: 7,
    lines: { warn: 14, crit: 3 },
    rows,
  };
}
const monDisk = (node, mount, status, daysLeft, growthGb, sizeGb, usedGb) => ({
  node,
  mount,
  primary: true,
  status,
  daysLeft,
  growthBytesPerDay: growthGb == null ? null : growthGb * 1e9,
  r2: daysLeft == null ? null : 0.97,
  samples: daysLeft == null ? 0 : 169,
  sizeBytes: sizeGb == null ? null : sizeGb * 1e9,
  usedBytes: usedGb == null ? null : usedGb * 1e9,
});

function MonitoringDiskRunwayState() {
  const panel = (chart, title) => (
    <ChartPanel chart={{ ...chart, title }} range={monRange('24h')} busy={false} />
  );
  const all = monRunway([
    monDisk('storage', '/volume1', 'ok', 2.5, 20, 11500, 11450),
    monDisk('pve', '/', 'ok', 9, 1.5, 240, 226),
    monDisk('apps', '/', 'ok', 142, 0.9, 250, 122),
    monDisk('lab', '/data', 'noisy', null, 3, 500, 300),
    monDisk('ms-s1', null, 'nodata', null, null, null, null),
    monDisk('edge', '/', 'stable', null, 0, 128, 41),
  ]);
  return (
    <Stack width={560}>
      <MonitoringSection title="Capacity" question="Which disk fills first?">
        <Caption>Worst first: critical and warning lamps, a noisy disk, a node that is off, one not filling; the first disk projected</Caption>
        {panel(all, 'Disk runway')}
        <Caption>No disk has a date: words only, no projection</Caption>
        {panel(
          monRunway([monDisk('lab', '/data', 'noisy', null, 3, 500, 300), monDisk('ms-s1', null, 'nodata', null, null, null, null)]),
          'Disk runway, no dates'
        )}
        <Caption>No nodes</Caption>
        {panel(monRunway([]), 'Disk runway, no nodes')}
        <Caption>Prometheus failing</Caption>
        {panel(monFailed(all, 'Prometheus refused the connection'), 'Disk runway, failing')}
      </MonitoringSection>
    </Stack>
  );
}

// The Monitoring page's Restarts and OOM kills chart (#761), a hand-made answer of the server's shape.
function monRestarts() {
  const stepMs = 300_000;
  const endMs = MON_END;
  const startMs = endMs - 288 * stepMs;
  const at = (f) => startMs + Math.round((f * 288)) * stepMs;
  const RESET = 'process restarted';
  const events = [
    { time: at(0.12), kind: 'restart', node: 'apps', name: 'nextcloud', how: 'container recreated' },
    { time: at(0.31), kind: 'restart', node: 'apps', name: 'jellyfin', how: RESET },
    { time: at(0.55), kind: 'oom', node: 'apps', name: 'paperless-ngx', count: 1 },
    { time: at(0.56), kind: 'restart', node: 'apps', name: 'paperless-ngx', how: RESET },
    { time: at(0.64), kind: 'oom', node: 'storage', name: 'photoprism', count: 1 },
    { time: at(0.83), kind: 'oom', node: 'apps', name: 'paperless-ngx', count: 2 },
    ...[0.7, 0.76, 0.82, 0.88, 0.94].map((f) => ({ time: at(f), kind: 'restart', node: 'storage', name: 'backrest', how: RESET })),
  ].sort((a, b) => a.time - b.time);
  return {
    id: 'restarts',
    title: 'Restarts and OOM kills',
    question: 'What restarted or was OOM-killed, and when?',
    section: 'containers',
    ok: true,
    state: 'ok',
    startMs,
    endMs,
    stepMs,
    events,
    truncated: false,
    blindNodes: [],
    oomCounter: true,
  };
}

function MonitoringRestartsState() {
  const chart = monRestarts();
  const panel = (c, title, range = '24h') => (
    <ChartPanel chart={{ ...c, title }} range={monRange(range)} busy={false} />
  );
  return (
    <Stack width={560}>
      <MonitoringSection title="Containers" question="Which container leaks, and what restarted?">
        <Caption>24 h: a circle is a restart, a cross an OOM kill; only containers with events</Caption>
        {panel(chart, 'Restarts and OOM kills')}
        <Caption>Nothing in range</Caption>
        {panel({ ...chart, events: [] }, 'Restarts and OOM kills, none')}
        <Caption>A node and the OOM counter unread: said under the strip</Caption>
        {panel({ ...chart, blindNodes: ['nas'], oomCounter: false }, 'Restarts and OOM kills, gaps')}
        <Caption>cAdvisor reports no containers: unknown, not quiet</Caption>
        {panel({ ...chart, state: 'no-containers', events: [] }, 'Restarts and OOM kills, no containers')}
        <Caption>Prometheus failing</Caption>
        {panel(monFailed(chart, 'Prometheus refused the connection'), 'Restarts and OOM kills, failing')}
      </MonitoringSection>
    </Stack>
  );
}

function MonitoringMemoryGrowersState() {
  const end = Date.UTC(2026, 9, 29, 12, 0, 0);
  const trendOf = (base, growth, n) =>
    Array.from({ length: 84 }, (_, i) => Math.round(base + (growth * i) / 83 + growth * 0.05 * Math.sin(i / 3 + n)));
  const rowOf = (node, name, base, growth, n) => ({
    key: `${node}/${name}`,
    node,
    name,
    growthBytes: growth,
    trend: trendOf(base, growth, n),
  });
  const growers = {
    id: 'container-growth',
    title: 'Container memory growers',
    question: 'Which container is leaking?',
    section: 'resources',
    ok: true,
    state: 'ok',
    trendStartMs: end - 83 * 7_200_000,
    trendStepMs: 7_200_000,
    rows: [
      rowOf('apps', 'loki', 1.9e9, 2.4e9, 0),
      rowOf('apps', 'immich-server', 1.2e9, 1.1e9, 1),
      rowOf('storage', 'win11-vm-agent', 3.1e9, 0.7e9, 2),
      rowOf('apps', 'grafana', 0.45e9, 0.3e9, 3),
      { ...rowOf('edge', 'adguard', 0.2e9, 0.12e9, 4), trend: null },
    ],
  };
  const panel = (chart, title) => (
    <ChartPanel chart={{ ...chart, title }} range={monRange('24h')} busy={false} />
  );
  return (
    <Stack width={560}>
      <MonitoringSection title="Resources" question="Is any node short of CPU, memory or bandwidth?">
        <Caption>Top growers, a week of working set beside each; one with no trend</Caption>
        {panel(growers, 'Container memory growers')}
        <Caption>The rule has series, nothing grew</Caption>
        {panel({ ...growers, rows: [] }, 'Container memory growers, none')}
        <Caption>The recording rule is missing: not available, with the cause</Caption>
        {panel({ ...growers, state: 'no-rule', rows: [] }, 'Container memory growers, no rule')}
        <Caption>No container series at all</Caption>
        {panel({ ...growers, state: 'no-cadvisor', rows: [] }, 'Container memory growers, no cAdvisor')}
        <Caption>Prometheus failing</Caption>
        {panel(monFailed(growers, 'Prometheus refused the connection'), 'Container memory growers, failing')}
      </MonitoringSection>
    </Stack>
  );
}

function MonitoringSectionState() {
  return (
    <Stack width={520}>
      <MonitoringNote>The charts couldn’t be read (Network down).</MonitoringNote>
      <MonitoringSection title="Resources" question="Is any node short of CPU, memory or bandwidth?">
        {/* The chart a banner's View graph opened (#752): ringed, with its tag. */}
        <Panel
          title="CPU by node"
          titleAs="h3"
          description="Is a node's CPU off?"
          {...chartFocus(true, <ChartFocusTag state="warn">Warning · CPU 93 %</ChartFocusTag>)}
        >
          <Chart
            label="CPU by node, last hour"
            series={CHART_CPU}
            formatValue={pct}
            height={72}
            {...HOUR_CHART}
          />
        </Panel>
        <Panel title="Memory by node" titleAs="h3" description="Is memory or swap under strain?">
          <Chart
            label="Memory by node, last hour"
            series={[]}
            state="failed"
            failedText="Prometheus refused the memory query (HTTP 400)"
            height={72}
          />
        </Panel>
      </MonitoringSection>
      <MonitoringOther>
        <span>2 other issues</span>
        <a href="/alerts">Alerts →</a>
      </MonitoringOther>
      <MonitoringSection title="Containers" question="Which container leaks, and what restarted?" loading />
    </Stack>
  );
}

function ChartSeriesState() {
  return (
    <Stack width={520}>
      <Panel title="Usage" description="Three series: solid, labelled at their ends">
        <Chart label="Usage, last hour" series={CHART_USAGE} formatValue={pct} {...HOUR_CHART} />
      </Panel>
      <Panel title="CPU by node" description="Six series: slots 4 to 6 dashed, every line labelled">
        <Chart
          label="CPU by node, last hour"
          series={CHART_NODES}
          formatValue={pct}
          height={160}
          {...HOUR_CHART}
        />
      </Panel>
    </Stack>
  );
}

// Reference lines and the max band (#746): the values are the caller's (the
// monitoring page passes status/thresholds.js's); these are made up.
const CHART_THRESHOLDS = [
  { level: 'warn', value: 80, mark: true },
  { level: 'crit', value: 90, mark: true },
];
// An average that crosses warn and then crit once, with its peak behind it.
const CHART_BREACH = [
  {
    key: 'cpu',
    name: 'CPU',
    points: hour(24, 8, 0).map((p, i) => ({
      ...p,
      value: i > 30 && i < 48 ? Math.min(96, 60 + (i - 30) * 3 - Math.max(0, i - 44) * 8) : p.value,
    })),
  },
];
const CHART_PEAK = {
  name: 'Peak',
  points: CHART_BREACH[0].points.map((p) => ({ ...p, value: Math.min(100, p.value + 12) })),
};

function ChartThresholdsState() {
  return (
    <Stack width={520}>
      <Panel title="CPU, healthy" description="Both lines drawn, never reached">
        <Chart
          label="CPU, last hour"
          series={CHART_CPU}
          formatValue={pct}
          height={96}
          thresholds={CHART_THRESHOLDS}
          {...HOUR_CHART}
        />
      </Panel>
      <Panel title="CPU, flagged" description="The breached span marked, the peak behind the line">
        <Chart
          label="CPU with peak, last hour"
          series={CHART_BREACH}
          formatValue={pct}
          height={120}
          thresholds={CHART_THRESHOLDS}
          band={CHART_PEAK}
          {...HOUR_CHART}
        />
      </Panel>
      <Panel title="Free space" description="A floor: the words under the line">
        <Chart
          label="Free space, last hour"
          series={[{ key: 'free', name: 'Free', points: hour(30, 14, 2) }]}
          formatValue={pct}
          height={96}
          thresholds={[
            { level: 'warn', value: 20, direction: 'below', mark: true },
            { level: 'crit', value: 10, direction: 'below', mark: true },
          ]}
          {...HOUR_CHART}
        />
      </Panel>
      <Panel title="Loading and failed" description="Neither draws a line or a band">
        <Stack gap={14}>
          <Chart
            label="CPU, last 7 days"
            series={[]}
            state="loading"
            height={72}
            thresholds={CHART_THRESHOLDS}
            band={CHART_PEAK}
          />
          <Chart
            label="CPU, last hour"
            series={[]}
            state="failed"
            detail="Prometheus didn't answer"
            height={72}
            thresholds={CHART_THRESHOLDS}
            band={CHART_PEAK}
          />
        </Stack>
      </Panel>
    </Stack>
  );
}

function ChartCrosshairState() {
  return (
    <Stack width={520}>
      <Panel title="CPU by node" description="Last hour">
        <Chart
          label="CPU by node, last hour"
          series={CHART_NODES}
          formatValue={pct}
          height={160}
          {...HOUR_CHART}
        />
      </Panel>
    </Stack>
  );
}

// Restarts and OOM kills over the same hour (#750): three containers have events,
// a fourth has none and is not drawn.
const EVENT_ROWS = [
  {
    key: 'immich',
    name: 'immich-server',
    events: [
      { time: T0 + 12 * 60_000, kind: 'restart', detail: 'exit 1, 2 restarts in an hour' },
      { time: T0 + 14 * 60_000, kind: 'restart', detail: 'exit 1, 2 restarts in an hour' },
      { time: T0 + 47 * 60_000, kind: 'oom', detail: 'killed at its 2 GB limit' },
    ],
  },
  { key: 'caddy', name: 'caddy', events: [] },
  {
    key: 'loki',
    name: 'loki',
    events: [{ time: T0 + 31 * 60_000, kind: 'oom', detail: 'killed at its 1 GB limit' }],
  },
  {
    key: 'radicale',
    name: 'radicale',
    events: [{ time: T0 + 55 * 60_000, kind: 'restart', detail: 'exit 0, after an update' }],
  },
];
const EVENT_RANGE = { from: T0, to: T0 + 60 * 60_000 };

function EventStripState() {
  return (
    <Stack width={520}>
      <Panel title="Containers" description="Flagged: restarts and OOM kills, last hour">
        <ChartGroup>
          <Chart
            label="CPU, last hour"
            series={CHART_CPU}
            formatValue={pct}
            height={72}
            {...HOUR_CHART}
          />
          <EventStrip
            label="Restarts and OOM kills, last hour"
            rows={EVENT_ROWS}
            {...EVENT_RANGE}
            {...HOUR_CHART}
          />
        </ChartGroup>
      </Panel>
      <Panel title="Healthy" description="Nothing restarted in the range">
        <EventStrip
          label="Restarts and OOM kills, last hour"
          rows={[EVENT_ROWS[1]]}
          emptyText="No restarts or OOM kills in the last hour"
          {...EVENT_RANGE}
          {...HOUR_CHART}
        />
      </Panel>
      <Panel title="Loading" description="Waiting for Prometheus">
        <EventStrip label="Restarts and OOM kills, last hour" state="loading" />
      </Panel>
      <Panel title="Failed" description="Prometheus not answering">
        <EventStrip
          label="Restarts and OOM kills, last hour"
          state="failed"
          detail="Prometheus didn't answer"
        />
      </Panel>
    </Stack>
  );
}

// Network in and out (#747): rates in bytes a second, made up and repeatable.
const rate = (base, swing, phase) =>
  hour(base, swing, phase).map((p) => ({ ...p, value: Math.max(0, p.value) }));
const mbps = (v) => `${Math.floor(v)} MB/s`;
const NET_IN = { key: 'in', name: 'In', points: rate(42, 18, 0.5) };
const NET_OUT = { key: 'out', name: 'Out', points: rate(14, 7, 2) };
// A node that was off from 08:25 to 08:33: both directions have no reading.
const off = (s) => ({
  ...s,
  points: s.points.map((p, i) => (i > 24 && i < 33 ? { ...p, value: null } : p)),
});
const NET = { height: 144, formatValue: mbps, ...HOUR_CHART };

function AreaChartState() {
  return (
    <Stack width={520}>
      <Panel title="Traffic" description="In above the zero line, out below">
        <Stack gap={14}>
          <Caption>Healthy: mirrored, one symmetric axis</Caption>
          <AreaChart mirrored label="Traffic, last hour" series={[NET_IN, NET_OUT]} {...NET} />
          <Caption>Flagged: the node was off for a while, so the area breaks</Caption>
          <AreaChart
            mirrored
            label="Traffic with a node off"
            series={[off(NET_IN), off(NET_OUT)]}
            {...NET}
          />
          <Caption>Plain area</Caption>
          <AreaChart label="Inbound, last hour" series={[NET_IN]} {...NET} height={96} />
          <Caption>Prometheus not answering</Caption>
          <AreaChart
            mirrored
            label="Traffic, last day"
            series={[]}
            state="failed"
            detail="Prometheus didn't answer"
            height={72}
          />
          <Caption>No readings in the range</Caption>
          <AreaChart mirrored label="Traffic, last week" series={[]} height={72} />
          <Caption>Loading</Caption>
          <AreaChart
            mirrored
            label="Traffic, last 30 days"
            series={[]}
            state="loading"
            height={72}
          />
        </Stack>
      </Panel>
    </Stack>
  );
}

// ── SmallMultiples (chart kit, #749) ──
// CPU by node, last hour: the cells share one axis; the values are made up.
const MULTI_NODES = [
  { key: 'edge', name: 'Network Edge', points: hour(24, 8, 0) },
  { key: 'app', name: 'App Server', points: hour(38, 10, 1) },
  { key: 'store', name: 'Storage', points: hour(18, 5, 2) },
  { key: 'media', name: 'Media', points: hour(30, 9, 3) },
];
const MULTI_HOT = MULTI_NODES.map((c) =>
  c.key === 'app'
    ? {
        ...c,
        points: c.points.map((p, i) => ({
          ...p,
          value: i > 40 ? Math.min(96, p.value + (i - 40) * 3) : p.value,
        })),
      }
    : c
);
const MULTI_OFF = MULTI_NODES.map((c) =>
  c.key === 'store' ? { ...c, points: c.points.map((p) => ({ ...p, value: null })) } : c
);
const MULTI = {
  label: 'CPU by node, last hour',
  formatValue: pct,
  thresholds: CHART_THRESHOLDS,
  ...HOUR_CHART,
};

function SmallMultiplesState() {
  return (
    <Stack width={720}>
      <Panel title="Healthy" description="One shared scale; warn and critical lines never reached">
        <SmallMultiples cells={MULTI_NODES} {...MULTI} />
      </Panel>
      <Panel title="Flagged" description="App Server past its lines: the word beside the figure">
        <SmallMultiples cells={MULTI_HOT} {...MULTI} />
      </Panel>
      <Panel title="No data cell" description="Storage is off: a gap, never zero">
        <SmallMultiples cells={MULTI_OFF} {...MULTI} />
      </Panel>
      <Panel title="Highlighted" description="View graph: the selected ring and a text tag">
        <SmallMultiples
          cells={MULTI_HOT.map((c) =>
            c.key === 'app' ? { ...c, highlighted: 'Critical · 96 % busy' } : c
          )}
          {...MULTI}
        />
      </Panel>
      <Panel title="Loading" description="Waiting for Prometheus">
        <SmallMultiples cells={[]} state="loading" {...MULTI} />
      </Panel>
      <Panel title="Failed" description="Prometheus not answering">
        <SmallMultiples cells={[]} state="failed" detail="Prometheus didn't answer" {...MULTI} />
      </Panel>
    </Stack>
  );
}

function SmallMultiplesPhoneState() {
  return (
    <Stack width={390}>
      <Panel title="Healthy" description="Tap a row to open its chart">
        <SmallMultiples variant="phone" cells={MULTI_NODES} onOpen={() => {}} {...MULTI} />
      </Panel>
      <Panel title="Flagged, no data and highlighted" description="Rows are 44px or more">
        <SmallMultiples
          variant="phone"
          cells={MULTI_HOT.map((c) => ({
            ...c,
            ...(c.key === 'store' && { points: MULTI_OFF[2].points }),
            ...(c.key === 'app' && { highlighted: true }),
          }))}
          onOpen={() => {}}
          {...MULTI}
        />
      </Panel>
      <Panel title="Loading" description="Waiting for Prometheus">
        <SmallMultiples variant="phone" cells={[]} state="loading" {...MULTI} />
      </Panel>
      <Panel title="Failed" description="Prometheus not answering">
        <SmallMultiples
          variant="phone"
          cells={[]}
          state="failed"
          detail="Prometheus didn't answer"
          {...MULTI}
        />
      </Panel>
    </Stack>
  );
}

function EventStripCrosshairState() {
  return (
    <Stack width={520}>
      <Panel title="Containers" description="Last hour">
        <EventStrip
          label="Restarts and OOM kills, last hour"
          rows={EVENT_ROWS}
          {...EVENT_RANGE}
          {...HOUR_CHART}
        />
      </Panel>
    </Stack>
  );
}

function AreaChartCrosshairState() {
  return (
    <Stack width={520}>
      <Panel title="Traffic" description="Last hour">
        <AreaChart mirrored label="Traffic, last hour" series={[NET_IN, NET_OUT]} {...NET} />
      </Panel>
    </Stack>
  );
}

const RANGES = [
  { value: '1h', label: '1 h' },
  { value: '24h', label: '24 h' },
  { value: '7d', label: '7 d' },
];

function EntityDetailHistoryState() {
  return (
    <Stack width={420} gap={20}>
      <DetailTitle>Network Edge</DetailTitle>
      <DetailCharts
        range="1h"
        ranges={RANGES}
        onRangeChange={noop}
        {...HOUR_CHART}
        charts={[
          {
            key: 'usage',
            title: 'Usage',
            label: 'Usage, last hour',
            series: CHART_USAGE,
            domain: [0, 100],
            formatValue: pct,
            state: 'ready',
          },
          {
            key: 'temperature',
            title: 'Temperature',
            label: 'Temperature, last hour',
            series: CHART_TEMP,
            domain: 'auto',
            formatValue: degrees,
            state: 'ready',
          },
        ]}
      />
      <DetailTitle>jellyfin</DetailTitle>
      <DetailCharts
        title="History of jellyfin"
        range="7d"
        ranges={RANGES}
        onRangeChange={noop}
        {...HOUR_CHART}
        charts={[
          {
            key: 'cpu',
            title: 'CPU',
            label: 'CPU, last 7 days',
            series: [],
            state: 'failed',
            detail: "Prometheus didn't answer",
          },
          {
            key: 'memory',
            title: 'Memory',
            label: 'Memory, last 7 days',
            series: [],
            state: 'failed',
            detail: 'Prometheus refused the query',
          },
        ]}
      />
    </Stack>
  );
}

// ---------------------------------------------------------------- drive health (#728)

/**
 * A node's Drives as the drawer and the phone's sheet draw them, from the
 * status model's own drives (src/testing/driveFixtures.js builds the status
 * through server/status/model.js), so every state, word and reason is the
 * server's. `blind`: the exporter's series gone a cycle after.
 */
const DRIVES = (list, opts) => driveView(nasWith(list, opts).entity);

const NAS_HEALTHY = [
  hdd('sda', { temperature: 40 }),
  hdd('sdb', { temperature: 42 }),
  hdd('sdc', { temperature: 39 }),
];
const NAS_TROUBLE = [
  hdd('sda', { temperature: 57 }),
  hdd('sdb', { smartPassed: false, temperature: 42 }),
  hdd('sdc', { temperature: 39, sectors: sectors({ reallocated: { count: 8, grew: false } }) }),
  nvme('nvme0', { temperature: 31 }),
];

function DetailDrivesState() {
  return (
    <Stack width={420} gap={24}>
      <DetailTitle>UGREEN NAS</DetailTitle>
      <DetailDrives view={DRIVES(NAS_HEALTHY)} />
      <DetailDrives
        title="Drives, an NVMe alone"
        view={DRIVES([nvme('nvme0', { temperature: 30 })])}
      />
    </Stack>
  );
}

/** The footnote when the node declares how often its readings refresh (#732). */
function DetailDrivesCadenceState() {
  return (
    <Stack width={390} gap={24}>
      <DetailTitle>UGREEN NAS</DetailTitle>
      <DetailDrives view={DRIVES(NAS_HEALTHY, { readingSeconds: 3600 })} />
      <DetailDrives
        title="Drives, an NVMe alone"
        view={DRIVES([nvme('nvme0', { temperature: 30 })], { readingSeconds: 600 })}
      />
    </Stack>
  );
}

function DetailDrivesTroubleState() {
  return (
    <Stack width={420} gap={24}>
      <DetailTitle>UGREEN NAS</DetailTitle>
      <DetailDrives
        title="Drives, one failing (marked, open) and one warm"
        view={DRIVES(NAS_TROUBLE)}
        highlight="sdb"
      />
      <DetailDrives
        title="Drives, a warning from growing bad sectors"
        view={DRIVES([
          hdd('sda', { sectors: sectors({ reallocated: { count: 3, grew: true } }) }),
          nvme('nvme0', { availableSpare: 4 }),
        ])}
        highlight="sda"
      />
    </Stack>
  );
}

function DetailDrivesNoSignalState() {
  return (
    <Stack width={420} gap={24}>
      <DetailTitle>UGREEN NAS</DetailTitle>
      <DetailDrives
        title="Drives, the exporter's series gone"
        view={DRIVES(NAS_HEALTHY, { blind: true })}
      />
      <DetailDrives
        title="Drives, a stale status (last known)"
        view={driveView(nasWith(NAS_TROUBLE).entity, { stale: true })}
      />
    </Stack>
  );
}

/** The drawer's top of a node with a failing drive: status box, Drives, History with the drives' lines. */
function EntityDetailDrivesState() {
  const entity = nasWith(NAS_TROUBLE).entity;
  const drive = (key, name, base, swing, phase) => ({
    key,
    name,
    points: hour(base, swing, phase),
  });
  return (
    <Stack width={420} gap={20}>
      <DetailTitle>UGREEN NAS</DetailTitle>
      <PhoneDetailStatus
        state={entity.state}
        word={entity.word}
        reason={entity.reason}
        since="for 2 min"
        note="2 / 2 services up"
      />
      <DetailDrives view={driveView(entity)} highlight="sdb" />
      <DetailCharts
        range="1h"
        ranges={RANGES}
        onRangeChange={noop}
        {...HOUR_CHART}
        charts={[
          {
            key: 'temperature',
            title: 'Temperature',
            label: 'Temperature, last hour',
            series: [
              ...CHART_TEMP,
              drive('drive:nvme0', 'nvme0', 31, 0.8, 0.4),
              drive('drive:sda', 'sda', 56, 1.2, 1.1),
              drive('drive:sdb', 'sdb', 42, 0.6, 2.2),
              drive('drive:sdc', 'sdc', 39, 0.6, 3.1),
            ],
            domain: 'auto',
            formatValue: degrees,
            state: 'ready',
            note: '+2 more drives, not drawn \u00b7 Drives update about every 10 minutes',
          },
        ]}
      />
    </Stack>
  );
}

/** The phone's sheet of a node with a failing drive (src/phone/views/NodeDetail.jsx). */
function phoneNodeWithDrives(list, opts) {
  const model = nasWith(list, opts).entity;
  const data = phoneBoard('healthy');
  return {
    ...data,
    status: {
      ...data.status,
      entities: data.status.entities.map((e) =>
        e.id === 'nodes/jagnas'
          ? {
              ...e,
              state: model.state,
              word: model.word,
              reason: model.reason,
              drives: model.drives,
            }
          : e
      ),
    },
  };
}

function DriveHealthSettingState() {
  return (
    <Stack width={390} gap={16}>
      <DriveHealthSetting title="Drive health: on" state="on" />
      <DriveHealthSetting title="Drive health: off" state="off" />
    </Stack>
  );
}

const STRIPS = [
  ['sm, every check up', <UptimeBar key="a" beats={BEATS_OK} />],
  ['sm, failing now', <UptimeBar key="b" beats={BEATS_FAILING} />],
  ['sm, two failures', <UptimeBar key="c" beats={BEATS_FLAKY} />],
  ['md, pending (warn)', <UptimeBar key="d" beats={BEATS_PENDING} size="md" />],
  ['md, maintenance stays quiet', <UptimeBar key="e" beats={BEATS_MAINTENANCE} size="md" />],
  ['lg, padded to 30', <UptimeBar key="f" beats={BEATS_FLAKY.slice(0, 12)} count={30} size="lg" />],
  ['sm, no data', <UptimeBar key="g" beats={BEATS_NONE} />],
  ['sm, no checks yet', <UptimeBar key="h" beats={[]} count={30} />],
  [
    'sm, stale: failures in no signal',
    <UptimeBar key="i" beats={checks(CHECKS_DOWN)} count={30} stale />,
  ],
];

// #312: the drawer's strip focused, the newest check's tooltip open.
function UptimeBarTooltipState() {
  return (
    <Stack width={460}>
      <div style={{ paddingTop: 40 }}>
        <UptimeBar beats={checks(CHECKS_DOWN)} count={50} size="md" focusable />
      </div>
    </Stack>
  );
}

function UptimeBarState() {
  return (
    <Stack width={520}>
      <Panel title="Heartbeats">
        <Grid columns="200px 1fr" gap={14}>
          {STRIPS.flatMap(([caption, strip]) => [
            <Caption key={caption}>{caption}</Caption>,
            strip,
          ])}
        </Grid>
      </Panel>
    </Stack>
  );
}

function EntityRows() {
  return (
    <List>
      <li>
        <EntityRow
          state="ok"
          name="Immich"
          detail="24,499 assets"
          meta="42 ms"
          trailing={<UptimeBar beats={BEATS_OK} count={30} />}
          onOpen={noop}
        />
      </li>
      <li>
        <EntityRow
          state="crit"
          word="Down"
          name="Gitea"
          detail="Kuma: HTTP 502 for 4 min"
          meta="—"
          trailing={<UptimeBar beats={BEATS_FAILING} count={30} />}
          href="#gitea"
        />
      </li>
      <li>
        <EntityRow
          state="warn"
          word="Slow"
          name="Nextcloud"
          detail="1.8 s median over 10 min"
          meta="1.8 s"
          trailing={<UptimeBar beats={BEATS_PENDING} count={30} />}
          onOpen={noop}
        />
      </li>
      <li>
        <EntityRow
          state="unknown"
          name="Wiki.js"
          detail="No heartbeat yet · monitor added 2 min ago"
          meta="—"
          trailing={<UptimeBar beats={BEATS_NONE} count={30} />}
        />
      </li>
      <li>
        <EntityRow
          state="maintenance"
          name="Home Assistant"
          detail="Kuma maintenance until 10:00"
          meta="38 ms"
          trailing={<UptimeBar beats={BEATS_MAINTENANCE} count={30} />}
          onOpen={noop}
        />
      </li>
      <li>
        <EntityRow
          state="ok"
          name="Paperless-ngx document archive on staging"
          detail="12,031 documents, 4 in the inbox waiting for tags"
          meta="61 ms"
          trailing={<Sparkline label="CPU, last hour" points={CPU} decorative />}
          onOpen={noop}
        />
      </li>
    </List>
  );
}

function EntityRowState({ width }) {
  return (
    <Stack width={width}>
      <Panel flush title="Services" description="31 of 32 up">
        <EntityRows />
      </Panel>
    </Stack>
  );
}

function FactListState() {
  return (
    <Row align="start" gap={24}>
      <Stack width={420}>
        <Caption>420px: the Overview drawer</Caption>
        <FactList facts={UPS_FACTS} />
        <FactList facts={SERVICE_FACTS} />
      </Stack>
      <Stack width={340}>
        <Caption>340px: the phone</Caption>
        <FactList facts={UPS_FACTS} />
        <FactList facts={SERVICE_FACTS} />
      </Stack>
    </Row>
  );
}

const LONG_FACTS = [
  {
    key: 'url',
    label: 'Address',
    value: 'https://photos.jagbhandal.com/api/server/ping?verbose=true&format=json',
  },
  {
    key: 'image',
    label: 'Image',
    value: <code>sha256:3f9c2e1a7b6d4c08e5f2a91b3c7d6e4f5a8b9c0d</code>,
  },
  {
    key: 'host',
    label: 'Backup target',
    value: <code>backup-target.storage.jagbhandal.internal</code>,
  },
  { key: 'note', label: 'Note', value: 'Words still wrap between words first, as any value does.' },
];

function FactListLongState() {
  return (
    <Row align="start" gap={24}>
      <Stack width={420}>
        <Caption>420px: the Overview drawer</Caption>
        <FactList facts={LONG_FACTS} />
      </Stack>
      <Stack width={340}>
        <Caption>340px: the phone</Caption>
        <FactList facts={LONG_FACTS} />
      </Stack>
    </Row>
  );
}

// The detail's parts (#310), as src/shell/detail/entityExtras.js builds them:
// a Proxmox node, and a service with a container and an integration.
const DETAIL_NODE_METERS = [
  { key: 'cpu', label: 'CPU', value: 23.8, unit: '%', max: 100, state: 'ok', warn: 90, band: 5 },
  { key: 'mem', label: 'Memory', value: 62.2, unit: '%', max: 100, state: 'ok', warn: 90, band: 5 },
  { key: 'disk', label: 'Disk', value: 60.6, unit: '%', max: 100, state: 'ok', ...LINES.disk },
  {
    key: 'temp',
    label: 'Temp',
    value: 51,
    unit: '°C',
    max: 100,
    state: 'ok',
    warn: 75,
    crit: 85,
    band: 5,
  },
];
const DETAIL_NODE_SECTIONS = [
  {
    key: 'vms',
    kind: 'vms',
    title: 'Virtual machines',
    aside: '2 / 3 running',
    vms: [
      {
        key: '103',
        name: 'docker-brain',
        status: 'Running',
        running: true,
        detail: '8 vCPU · 21.4 / 32.0 GB · ID 103',
      },
      {
        key: '101',
        name: 'staging',
        status: 'Running',
        running: true,
        detail: '4 vCPU · 3.1 / 8.0 GB · ID 101',
      },
      { key: '110', name: 'win11', status: 'Stopped', running: false, detail: '4 vCPU · ID 110' },
    ],
  },
  {
    key: 'pools',
    kind: 'meters',
    title: 'Storage pools',
    meters: [
      {
        key: 'pool:local',
        label: 'local',
        value: 12.8,
        unit: '%',
        max: 100,
        state: 'ok',
        ...LINES.disk,
        caption: '12.0 / 94.0 GB · dir',
      },
      {
        key: 'pool:local-lvm',
        label: 'local-lvm',
        value: 94.6,
        unit: '%',
        max: 100,
        state: 'warn',
        ...LINES.disk,
        caption: '851.2 / 900.0 GB · lvmthin',
      },
    ],
  },
  {
    key: 'backup',
    kind: 'facts',
    title: 'Last backup',
    facts: [
      { key: 'when', label: 'When', value: '3 h ago' },
      { key: 'result', label: 'Result', value: 'OK' },
      { key: 'vms', label: 'Backed up', value: '2 VMs' },
    ],
  },
];
const DETAIL_SERVICE_SECTIONS = [
  {
    key: 'container',
    kind: 'facts',
    title: 'Container',
    aside: 'jellyfin',
    facts: [
      { key: 'cpu', label: 'CPU', value: '11.8 %' },
      { key: 'memory', label: 'Memory', value: '1.3 GB' },
      { key: 'rx', label: 'RX', value: '1.1 MB/s' },
      { key: 'tx', label: 'TX', value: '6.2 MB/s' },
    ],
  },
  {
    key: 'integration',
    kind: 'facts',
    title: 'From jellyfin',
    facts: [
      { key: 'Movies', label: 'Movies', value: '1,204' },
      { key: 'Shows', label: 'Shows', value: '87' },
    ],
    note: 'Its last read failed: HTTP 502',
  },
];

/** The detail's title, an h2 as the drawer's and the sheet's, over its sections' h3s. */
function DetailTitle({ children }) {
  return (
    <h2 style={{ fontSize: 20, lineHeight: '26px', fontWeight: 700, color: 'var(--jh-text-1)' }}>
      {children}
    </h2>
  );
}

function EntityDetailNodeState() {
  return (
    <Stack width={420} gap={20}>
      <DetailTitle>App Server</DetailTitle>
      <DetailMeters meters={DETAIL_NODE_METERS} />
      <FactList
        facts={[
          { key: 'uptime', label: 'Uptime', value: '12d 3h' },
          { key: 'memory', label: 'Memory', value: '9.7 / 15.6 GB' },
          { key: 'disk', label: 'Disk', value: '148.6 / 245.1 GB' },
        ]}
      />
      <DetailSections sections={DETAIL_NODE_SECTIONS} />
      <DetailLinks
        primary={{ key: 'proxmox', label: 'Open Proxmox', href: '#proxmox', app: false }}
        links={[{ key: 'grafana', label: 'Grafana', href: '#grafana', app: true }]}
        settings={{ key: 'settings', label: 'Node settings', href: '#settings', app: true }}
      />
    </Stack>
  );
}

// A backup's detail (#578): its schedule and last report, the overdue line
// over its last runs (a failed one's error under it), and its Remove, the
// last one failed.
const DETAIL_JOB_SECTIONS = [
  {
    key: 'runs',
    kind: 'runs',
    title: 'Last runs',
    note: 'Last report 31 h ago · expected every 24 h',
    noteState: 'warn',
    runs: [
      {
        key: '1',
        state: 'crit',
        word: 'Failed',
        time: 'Oct 21, 03:00',
        duration: '4 s',
        error: 'repository is locked by another process',
      },
      { key: '2', state: 'ok', word: 'Succeeded', time: 'Oct 20, 03:00', duration: '23 min' },
      { key: '3', state: 'ok', word: 'Succeeded', time: 'Oct 19, 03:00', duration: '22 min 41 s' },
    ],
  },
];

function EntityDetailJobState() {
  return (
    <Stack width={420} gap={20}>
      <DetailTitle>nas-b2-backup</DetailTitle>
      <FactList
        facts={[
          { key: 'schedule', label: 'Schedule', value: 'daily at 03:00 (Ofelia, America/Toronto)' },
          { key: 'last', label: 'Last report', value: '31 h ago' },
        ]}
      />
      <DetailSections sections={DETAIL_JOB_SECTIONS} />
      <DetailRemove
        title="Remove this backup?"
        name="nas-b2-backup"
        detail="On storage"
        description="Its last runs go with it. It comes back the next time it reports."
        error={{
          title: "Couldn't remove nas-b2-backup",
          cause: 'JagHelm answered HTTP 500. Nothing was removed.',
        }}
        onConfirm={() => {}}
      />
    </Stack>
  );
}

function EntityDetailServiceState() {
  return (
    <Stack width={420} gap={20}>
      <DetailTitle>Jellyfin</DetailTitle>
      <DetailHeartbeats beats={checks(`${up(10)}${CHECKS_BLIP}`, 64)} />
      <FactList
        facts={[
          { key: 'latency', label: 'Latency', value: '64 ms' },
          { key: 'uptime', label: 'Uptime · 24 h', value: '99.9 %' },
          { key: 'node', label: 'Node', value: 'App Server' },
        ]}
      />
      <DetailSections sections={DETAIL_SERVICE_SECTIONS} />
      <DetailUnread
        unread={[{ key: 'integrations', what: "the integrations' stats", error: 'HTTP 502' }]}
      />
      <DetailLinks
        primary={{ key: 'open', label: 'Open Jellyfin', href: '#jellyfin', app: true }}
        links={[
          { key: 'kuma', label: 'Uptime Kuma', href: '#kuma', app: true },
          { key: 'grafana', label: 'Grafana', href: '#grafana', app: false },
        ]}
        settings={{ key: 'settings', label: 'Service settings', href: '#settings', app: true }}
      />
    </Stack>
  );
}

function TableState() {
  return (
    <Table caption="Nodes" columns={NODE_COLUMNS} rows={NODES} onRowOpen={noop} minWidth={720} />
  );
}

function TableEmptyState() {
  return (
    <Table caption="Nodes" columns={NODE_COLUMNS} rows={[]} empty="No nodes match this filter" />
  );
}

function TableScrollState() {
  return (
    <Stack width={420}>
      <Table caption="Nodes" columns={NODE_COLUMNS} rows={NODES} onRowOpen={noop} minWidth={720} />
    </Stack>
  );
}

function InfrastructureState({ nodes, count, view = 'cards', width = 900 }) {
  return (
    <Stack width={width}>
      <InfrastructureSection nodes={nodes} count={count} view={view} onViewChange={noop} />
    </Stack>
  );
}

// No custom group yet: Group disabled, and where to add one (#300).
const NO_GROUPS = [GROUPINGS[0], { ...GROUPINGS[1], disabled: true }];
const NO_GROUPS_HINT = (
  <>
    No custom groups yet: <a href="/settings/nodes#custom-groups">add one in Settings → Nodes & Services</a>
  </>
);

// The Overview's last line, to the Services page (#313).
const showAllOf = (groups) => {
  const n = groups.reduce((sum, g) => sum + g.rows.length, 0);
  return { href: '/services', label: `Show all ${n} services` };
};

function ServicesState({ groups, count, grouping = 'node', groupless = false, width = 900 }) {
  return (
    <Stack width={width}>
      <ServicesSection
        groups={groups}
        count={count}
        grouping={grouping}
        groupings={groupless ? NO_GROUPS : GROUPINGS}
        groupingHint={groupless ? NO_GROUPS_HINT : undefined}
        onGroupingChange={noop}
        showAll={showAllOf(groups)}
      />
    </Stack>
  );
}

// ── Compose stacks (#642) ────────────────────────────────────────────────
// One row per stack: the lead's row with its "+3" chip and the rollup of its
// containers (the model's `stack`, server/status/stacks.js), and the panel
// that lists them.
const stackOf = (count, chip, bad = false) => ({ count, chip, bad });
const SERVICES_STACKS = [
  {
    key: 'node:vm-103',
    title: 'Production',
    host: 'vm-103',
    count: '5 / 7 up',
    rows: [
      svc('vm-103', 'Immich', 'crit', 'Degraded', 'Immich Redis is down', '—', {
        beats: checks(CHECKS_UP, 63),
        stack: stackOf(4, '+3 · 1 down', true),
      }),
      svc(
        'vm-103',
        'Prometheus metrics',
        'warn',
        'Degraded',
        'Prometheus Blackbox has stopped',
        '—',
        {
          beats: checks(CHECKS_UP, 18),
          stack: stackOf(4, '+3 · 1 stopped', true),
        }
      ),
      svc('vm-103', 'Nextcloud', 'ok', 'Up', '1.2 TB used · 6 users', '112 ms', {
        beats: checks(CHECKS_BLIP, 112),
        stack: stackOf(5, '+4'),
      }),
      svc('vm-103', 'Collabora', 'ok', 'Up', null, '74 ms', { beats: checks(CHECKS_UP, 74) }),
      svc('vm-103', 'Wiki.js', 'ok', 'Up', '48 pages', '88 ms', {
        beats: checks(CHECKS_UP, 88),
        stack: stackOf(3, '+2'),
      }),
      svc('vm-103', 'Loki', 'ok', 'Up', 'read proxy', '27 ms', {
        beats: checks(CHECKS_UP, 27),
        stack: stackOf(2, '+1'),
      }),
      svc('vm-103', 'Gitea', 'ok', 'Up', '12 repositories', '31 ms', {
        beats: checks(CHECKS_UP, 31),
      }),
    ],
  },
];

const STACK_MEMBERS = [
  {
    id: 'services/vm-103:immich_server',
    name: 'Immich Server',
    state: 'ok',
    word: 'Up',
    reason: 'Kuma: up',
    lead: true,
    image: 'ghcr.io/immich-app/immich-server:release',
    where: 'Production',
  },
  {
    id: 'services/vm-103:immich_machine_learning',
    name: 'Immich Machine Learning',
    state: 'ok',
    word: 'Running',
    reason: null,
    image: 'ghcr.io/immich-app/immich-machine-learning:release',
    where: 'Production',
  },
  {
    id: 'services/vm-103:immich_postgres',
    name: 'Immich Postgres',
    state: 'ok',
    word: 'Running',
    reason: null,
    image: 'tensorchord/pgvecto-rs:pg14-v0.2.0',
    where: 'Production',
  },
  {
    id: 'services/vm-103:immich_redis',
    name: 'Immich Redis',
    state: 'ok',
    word: 'Running',
    reason: null,
    image: 'docker.io/redis:6.2-alpine',
    where: 'Production',
  },
];
const STACK_DOWN = STACK_MEMBERS.map((m) =>
  m.name === 'Immich Redis' ? { ...m, state: 'crit', word: 'Down', reason: 'Exited (code 137)' } : m
);
const STACK_STOPPED = STACK_MEMBERS.map((m) =>
  m.name === 'Immich Redis'
    ? { ...m, state: 'warn', word: 'Missing', reason: 'Missing: no longer running' }
    : m
);

/** A stack's detail as the drawer (420px) or a phone's sheet (390px) draws it. */
function StackPanelState({ members, status, width = 420, controls = true }) {
  const count = members.length;
  return (
    <Stack width={width} gap={20}>
      <div>
        <p style={{ fontSize: 11, color: 'var(--jh-text-3)', textTransform: 'uppercase' }}>
          Stack · Compose project immich
        </p>
        <DetailTitle>Immich</DetailTitle>
        <p style={{ fontSize: 13, color: 'var(--jh-text-2)' }}>
          Production (vm-103) · {count} containers
        </p>
      </div>
      <PhoneDetailStatus {...status} />
      <DetailHeartbeats beats={checks(CHECKS_UP, 63)} of="Immich Server" />
      <FactList
        facts={[
          { key: 'latency', label: 'Response', value: '63 ms' },
          { key: 'uptime', label: 'Uptime · 30 d', value: '99.9 %' },
          { key: 'assets', label: 'Assets', value: '24,499' },
        ]}
      />
      <DetailStack
        stack={{ name: 'Immich', count, members }}
        onDetails={controls ? noop : undefined}
        onSetLead={controls ? noop : undefined}
        onUngroup={controls ? noop : undefined}
        onSplit={controls ? noop : undefined}
      />
      <DetailLinks
        primary={{ key: 'open', label: 'Open Immich', href: '#immich', app: true }}
        links={[]}
      />
    </Stack>
  );
}
const PANEL_DEGRADED = {
  state: 'crit',
  word: 'Degraded',
  reason: 'Immich Redis is down',
  note: '3 of 4 containers running',
  since: 'since 14:02 · 6 min ago',
};
const PANEL_STOPPED = {
  state: 'warn',
  word: 'Degraded',
  reason: 'Immich Redis has stopped',
  note: '3 of 4 containers running',
  since: 'since 14:02 · 6 min ago',
};
const PANEL_HEALTHY = {
  state: 'ok',
  word: 'Up',
  note: 'All 4 containers running',
  since: 'since 08:10 · 6 h ago',
};

/** Settings → Nodes & Services, a stack's container open on its Compose stack block. */
const STACK_EDITOR = {
  name: '',
  namePlaceholder: 'Immich Redis',
  icon: '',
  monitor: '__auto__',
  monitorItems: MONITOR_ITEMS,
  suggestion: { monitor: null, why: null },
  candidates: [],
  stack: {
    project: 'immich',
    text: 'Immich Redis is drawn inside the immich stack on vm-103, led by Immich Server.',
    members: [
      { key: 'immich_machine_learning', name: 'Immich Machine Learning' },
      { key: 'immich_postgres', name: 'Immich Postgres' },
      { key: 'immich_redis', name: 'Immich Redis' },
    ],
    lead: 'immich_server',
    isLead: false,
    folded: true,
    ungrouped: false,
    split: false,
    led: false,
  },
};
function SettingsStackState({ width = 880 }) {
  const nodes = [
    {
      key: 'vm-103',
      name: 'vm-103',
      icon: '🖥',
      color: '#8b5cf6',
      count: 3,
      open: true,
      services: [
        mappedRow(
          'immich_server',
          'Immich Server',
          { kind: 'monitored', monitor: 'Immich' },
          { stackNote: 'leads the immich stack' }
        ),
        mappedRow(
          'immich_redis',
          'Immich Redis',
          { kind: 'none' },
          {
            editing: true,
            editor: STACK_EDITOR,
            stackNote: 'in the immich stack',
          }
        ),
        mappedRow(
          'immich_postgres',
          'Immich Postgres',
          { kind: 'none' },
          { stackNote: 'in the immich stack' }
        ),
      ],
    },
  ];
  return (
    <Stack width={width}>
      <ServiceMap nodes={nodes} onToggleNode={noop} onStack={noop} />
    </Stack>
  );
}

// The Services and Infrastructure pages (#313): the sections with the filters
// the pages give them (src/shell/ServicesPage.jsx, InfrastructurePage.jsx).
const PAGE_STATE_ITEMS = [
  { value: 'all', label: 'All states' },
  { value: 'problems', label: 'Problems' },
  { value: 'ok', label: 'Up' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'no-signal', label: 'No signal' },
];
const PAGE_NODE_ITEMS = [
  { value: 'all', label: 'All nodes' },
  { value: 'edge', label: 'Network Edge' },
  { value: 'apps', label: 'App Server' },
  { value: 'storage', label: 'Storage' },
];
const PAGE_ROLE_ITEMS = [
  { value: 'all', label: 'All roles' },
  { value: 'Raspberry Pi 4', label: 'Raspberry Pi 4' },
  { value: 'Proxmox VM', label: 'Proxmox VM' },
  { value: 'NAS', label: 'NAS' },
  { value: 'Docker host', label: 'Docker host' },
];

function Filters({ search = '', label = 'Search services', state = 'all', second, clear }) {
  return (
    <ListFilters
      filters={[
        { kind: 'search', id: 'q', label, value: search, onValueChange: noop },
        { id: 'state', label: 'State', value: state, items: PAGE_STATE_ITEMS, onValueChange: noop },
        second,
      ].filter(Boolean)}
      onClear={clear ? noop : undefined}
    />
  );
}

const nodeFilter = (value = 'all') => ({
  id: 'node',
  label: 'Node',
  value,
  items: PAGE_NODE_ITEMS,
  onValueChange: noop,
});

function ListFiltersState() {
  return (
    <Stack width={900}>
      <Filters search="jelly" state="problems" second={nodeFilter('apps')} clear />
    </Stack>
  );
}

// The incident's services as the page gives them: each row with its node's
// name and its container, for the table.
const SERVICES_PAGE = SERVICES_INCIDENT.map((g) => ({
  ...g,
  rows: g.rows.map((r) => ({ ...r, nodeName: g.title, containerName: r.id.split(':')[1] })),
}));
const SERVICES_PROBLEMS = [
  {
    ...SERVICES_PAGE[0],
    count: '0 / 3 up',
    rows: SERVICES_PAGE[0].rows.filter((r) => ['crit', 'warn', 'unknown'].includes(r.state)),
  },
];

function ServicesPageState({ groups, count, view = 'list', filters, empty }) {
  return (
    <Stack width={900}>
      <ServicesSection
        groups={groups}
        count={count}
        grouping="node"
        groupings={GROUPINGS}
        onGroupingChange={noop}
        view={view}
        onViewChange={noop}
        table={<ServicesTable groups={groups} grouping="node" />}
        toolbar={filters}
        empty={empty}
      />
    </Stack>
  );
}

function InfrastructurePageState() {
  const shown = NODES_INCIDENT.filter((n) => n.state !== 'ok');
  return (
    <Stack width={900}>
      <InfrastructureSection
        nodes={shown}
        count="3 of 4 nodes · 1 critical, 1 warning, 1 no signal"
        view="cards"
        onViewChange={noop}
        toolbar={
          <Filters
            label="Search nodes"
            state="problems"
            second={{
              id: 'role',
              label: 'Role',
              value: 'all',
              items: PAGE_ROLE_ITEMS,
              onValueChange: noop,
            }}
            clear
          />
        }
      />
    </Stack>
  );
}

function JobsState({ groups, count, width = 900 }) {
  return (
    <Stack width={width}>
      <JobsSection groups={groups} count={count} />
    </Stack>
  );
}

// The Overview as a tablet draws it (#302, spec §8): its sections in one
// column, at the width the page gives them in a 768px and a 1024px window (the
// sidebar and the gutters taken), 476 and 680px: the attention panel with the
// strip under it, wrapping to its width, then Infrastructure and Services.
function OverviewColumnState({ width }) {
  return (
    <Stack width={width} gap={24}>
      <AttentionPanel
        {...INCIDENT}
        action={ALL_ALERTS}
        issues={ISSUES}
        between={<SubsystemStrip cells={CELLS} />}
      />
      <InfrastructureSection
        nodes={NODES_INCIDENT}
        count="4 nodes · 1 critical, 1 warning, 1 no signal"
        view="cards"
        onViewChange={noop}
      />
      <ServicesSection
        groups={SERVICES_INCIDENT}
        count="7 monitored · 1 down · 1 pending · 1 no signal · 1 in maintenance"
        grouping="node"
        groupings={GROUPINGS}
        onGroupingChange={noop}
        showAll={showAllOf(SERVICES_INCIDENT)}
      />
    </Stack>
  );
}

const SLOTS = ['Azure', 'Rose', 'Lime', 'Plum', 'Orange', 'Teal'];

function Slots() {
  return (
    <Stack gap={10}>
      <svg width="360" height="48" viewBox="0 0 360 48" aria-hidden="true">
        {SLOTS.map((name, i) => (
          <polyline
            key={name}
            fill="none"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            style={{ stroke: `var(--jh-series-${i + 1})` }}
            points={[0, 1, 2, 3, 4, 5, 6]
              .map((x) => `${4 + x * 58},${8 + ((i * 6 + x * 7 + (x % 2) * 9) % 32)}`)
              .join(' ')}
          />
        ))}
      </svg>
      <Row gap={14}>
        {SLOTS.map((name, i) => (
          <span key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: `var(--jh-series-${i + 1})`,
              }}
            />
            <span style={{ color: 'var(--jh-text-2)', fontSize: 12 }}>
              {i + 1} {name}
            </span>
          </span>
        ))}
      </Row>
    </Stack>
  );
}

function ChartColoursState() {
  return (
    <Stack>
      <Caption>On the page (bg)</Caption>
      <Slots />
      <Panel title="On a panel (surface-1)" description="The sequential ramp, steps 1 to 7">
        <Slots />
        <Row gap={4}>
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <span
              key={n}
              style={{ width: 40, height: 24, borderRadius: 4, background: `var(--jh-seq-${n})` }}
            />
          ))}
        </Row>
      </Panel>
      <div
        style={{
          background: 'var(--jh-surface-2)',
          borderRadius: 12,
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <Caption>On surface-2 (a hovered tile, a chart&apos;s tooltip)</Caption>
        <Slots />
      </div>
    </Stack>
  );
}

// ---------------------------------------------------------------- utilities

// The gallery's frozen clock (09:00 UTC), and times before it.
const GALLERY_NOW = Date.UTC(2026, 9, 20, 9, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;

const quickLink = (name) => ({ id: name, name, href: '#', monogram: appMonogram(name) });
const LINK_GROUPS = [
  {
    key: 'daily',
    title: 'Daily',
    links: ['Nextcloud', 'Immich', 'Home Assistant', 'Vaultwarden'].map(quickLink),
  },
  {
    key: 'admin',
    title: 'Admin',
    links: ['Arcane', 'Proxmox', 'Grafana', 'Gitea', 'Uptime Kuma', 'AdGuard Home'].map(quickLink),
  },
];
const LINK_GROUPS_WIDE = [
  ...LINK_GROUPS,
  {
    key: 'devops',
    title: 'Dev & Monitoring',
    links: ['Prometheus', 'Loki', 'Nginx Proxy Manager'].map(quickLink),
  },
];

// Each row's CI result (#532): passed, failed on a branch, running, and a
// repo without Actions (no lamp).
const CI = {
  ok: { state: 'ok', word: 'Passed' },
  crit: { state: 'crit', word: 'Failed' },
  unknown: { state: 'unknown', word: 'Running' },
};
const PIPELINE_ROWS = [
  ['Pin the reverse proxy image to 2.12', 'infrastructure', 'main', 'a41c9e2', 12 * MIN, 'ok'],
  ['Log every request', 'homelab-infra', 'fix/access-log-245', 'b81e0d2', HOUR, 'crit'],
  [
    'Add Quick Launch links for the photo library',
    'dashboard-config',
    'main',
    'c0f8a51',
    3 * HOUR,
    'unknown',
  ],
  ['Retry the library scan on a timeout', 'media-scripts', 'main', 'e7a3310', 26 * HOUR, null],
].map(([title, repo, ref, sha, ago, ci]) => ({
  id: sha,
  title,
  repo,
  ref,
  sha,
  ci: ci ? CI[ci] : null,
  at: GALLERY_NOW - ago,
}));

const TODOS = [
  {
    id: 'a',
    text: 'Rotate the B2 application key',
    done: false,
    dueLabel: 'Oct 18',
    overdue: true,
  },
  { id: 'b', text: 'Replace the UPS battery', done: false, dueLabel: 'Mar 1', overdue: false },
  { id: 'c', text: 'Review the Arcane vulnerability digest', done: true, dueLabel: null },
];

const HINT = 'in Ctrl K too';

const RailChecklist = ({ todos = TODOS, banner }) => (
  <Checklist todos={todos} banner={banner} onAdd={noop} onToggle={noop} onRemove={noop} />
);

// The weather as the rail draws it (#307): Toronto, in Celsius.
const WEATHER = { temperature: '9°C', condition: 'Overcast', code: 3, place: 'Toronto' };

function UtilitiesRailState() {
  return (
    <Stack width={300}>
      <UtilitiesRail>
        <WeatherClock weather={WEATHER} now={GALLERY_NOW} />
        <QuickLaunch groups={LINK_GROUPS} hint={HINT} />
        <Pipeline items={PIPELINE_ROWS} now={GALLERY_NOW} />
        <RailChecklist />
      </UtilitiesRail>
    </Stack>
  );
}

function LaunchPageState() {
  return (
    <Stack width={880}>
      <LaunchLayout
        extras={<WeatherClock weather={WEATHER} now={GALLERY_NOW} />}
        search={<WebSearch engine="DuckDuckGo" onSearch={noop} />}
        quickLaunch={<QuickLaunch groups={LINK_GROUPS_WIDE} hint={HINT} />}
        pipeline={<Pipeline items={PIPELINE_ROWS} now={GALLERY_NOW} />}
        checklist={<RailChecklist />}
      />
    </Stack>
  );
}

function UtilitiesEmptyState() {
  return (
    <Grid columns="repeat(2, 320px)">
      <QuickLaunch
        groups={[]}
        hint={HINT}
        empty={
          <EmptyState
            title="No links yet"
            description="Add the apps you open most in Settings → Apps & links."
            action={
              <a href="#links" className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}>
                Add links
              </a>
            }
          />
        }
      />
      <Stack>
        <Pipeline items={[]} now={GALLERY_NOW} />
        <RailChecklist todos={[]} />
      </Stack>
    </Grid>
  );
}

// The command palette (#315): a row in each of its groups, as
// src/shell/paletteIndex.js builds them; the list scrolls past the first few.
const entityRow = (id, label, kind, where, state, word) => ({
  id: `entity:${id}`,
  label,
  kind,
  where,
  detail: word,
  state,
  word,
  href: `/?entity=${id}`,
  onOpen: () => {},
});
const PALETTE_GROUPS = [
  {
    id: 'issues',
    heading: 'Issues',
    rows: [
      {
        id: 'issue:services/vm-103:immich',
        label: 'Immich',
        kind: 'Issue',
        where: 'Service · vm-103',
        detail: 'Kuma: HTTP 502 from photos.jagbhandal.com',
        state: 'crit',
        word: 'Down',
        href: '/?entity=services/vm-103:immich',
        onOpen: () => {},
      },
      {
        id: 'issue:power/ups',
        label: 'CyberPower CP1500',
        kind: 'Issue',
        where: 'Power',
        detail: 'On battery (64 % charge)',
        state: 'crit',
        word: 'On battery',
        href: '/?entity=power/ups',
        onOpen: () => {},
      },
    ],
  },
  {
    id: 'entities:services',
    heading: 'Services',
    rows: [
      entityRow('services/vm-103:immich', 'Immich', 'Service', 'vm-103', 'crit', 'Down'),
      entityRow('services/vm-103:grafana', 'Grafana', 'Service', 'vm-103', 'ok', 'Up'),
    ],
  },
  {
    id: 'entities:nodes',
    heading: 'Nodes',
    rows: [entityRow('nodes/pve', 'Proxmox', 'Node', 'pve', 'warn', 'Warning')],
  },
  {
    id: 'entities:power',
    heading: 'Power',
    rows: [entityRow('power/ups', 'CyberPower CP1500', 'UPS', undefined, 'crit', 'On battery')],
  },
  {
    id: 'entities:jobs',
    heading: 'Jobs',
    rows: [entityRow('jobs/vm-103:db-dump', 'db-dump', 'Job', 'vm-103', 'ok', 'OK')],
  },
  {
    id: 'entities:backups',
    heading: 'Backups',
    rows: [
      entityRow(
        'backups/pve:proxmox-backup',
        'proxmox-backup',
        'Backup',
        'pve',
        'maintenance',
        'Maintenance'
      ),
    ],
  },
  {
    id: 'entities:integrations',
    heading: 'Integrations',
    rows: [
      entityRow(
        'integrations/jellyfin',
        'jellyfin',
        'Integration',
        undefined,
        'unknown',
        'No signal'
      ),
    ],
  },
  {
    id: 'pages',
    heading: 'Pages',
    rows: [{ id: 'page:alerts', label: 'Alerts', kind: 'Page', href: '/alerts', onOpen: () => {} }],
  },
  {
    id: 'apps',
    heading: 'Apps',
    rows: [
      {
        id: 'app:grafana',
        label: 'Open Grafana',
        kind: 'App',
        detail: 'Opens inside JagHelm',
        href: '/apps/grafana',
        onOpen: () => {},
      },
    ],
  },
  {
    id: 'settings',
    heading: 'Settings',
    rows: [
      {
        id: 'settings:apps',
        label: 'Apps & links',
        kind: 'Settings',
        detail: 'Embedded apps, Quick Launch links, where links open, the web search.',
        href: '/settings/apps',
        onOpen: () => {},
      },
    ],
  },
  {
    id: 'links',
    heading: 'Quick Launch',
    rows: [
      {
        id: 'link:personal:0',
        label: 'Open Nextcloud',
        kind: 'Link',
        where: 'Personal',
        detail: 'cloud.jagbhandal.com',
        href: 'https://cloud.jagbhandal.com/',
        target: '_blank',
      },
    ],
  },
  {
    id: 'actions',
    heading: 'Actions',
    rows: [{ id: 'action:logout', label: 'Log out', kind: 'Action', onOpen: () => {} }],
  },
];

function CommandPaletteState({ query: start = '', groups = PALETTE_GROUPS }) {
  const [query, setQuery] = useState(start);
  return (
    <CommandPalette
      open
      onClose={() => {}}
      query={query}
      onQueryChange={setQuery}
      groups={groups}
    />
  );
}

/** A search, "gra", as paletteSearch leaves the groups: names that start with it first. */
const PALETTE_SEARCH = [
  {
    id: 'entities:services',
    heading: 'Services',
    rows: [entityRow('services/vm-103:grafana', 'Grafana', 'Service', 'vm-103', 'ok', 'Up')],
  },
  { id: 'apps', heading: 'Apps', rows: PALETTE_GROUPS.find((g) => g.id === 'apps').rows },
  {
    id: 'links',
    heading: 'Quick Launch',
    rows: [
      {
        id: 'link:devops:0',
        label: 'Open Grafana',
        kind: 'Link',
        where: 'Dev & Monitoring',
        detail: 'grafana.jagbhandal.com',
        href: 'https://grafana.jagbhandal.com/',
        target: '_blank',
      },
    ],
  },
];

// Each card is a landmark, named by what it holds, so the two weather-only
// ones are told apart here (axe's landmark-unique); the app draws one.
function UtilitiesWeatherState() {
  return (
    <Grid columns="repeat(2, 300px)">
      <WeatherClock now={GALLERY_NOW} />
      <WeatherClock
        weather={{ temperature: '88°F', condition: 'Thunderstorm', code: 95, place: 'Grove City' }}
        now={GALLERY_NOW}
      />
      <WeatherClock weather={{ loading: true, place: 'Toronto' }} />
      <WeatherClock weather={{ failed: true, place: 'Toronto' }} aria-label="Weather, no reading" />
    </Grid>
  );
}

function UtilitiesFailingState() {
  return (
    <Grid columns="repeat(2, 320px)">
      <Pipeline
        items={[]}
        banner={
          <Banner
            tone="unknown"
            title="Pipeline isn't updating"
            cause="Gitea didn't answer JagHelm"
          />
        }
      />
      <RailChecklist
        todos={null}
        banner={
          <Banner
            tone="unknown"
            title="Couldn't load the checklist"
            cause="JagHelm didn't answer"
            action={
              <Button variant="secondary" size="sm">
                Retry
              </Button>
            }
          />
        }
      />
    </Grid>
  );
}

// ---------------------------------------------------------------- registry

// ---------------------------------------------------------------- shell

// 12 seconds before the gallery's frozen clock (09:00:00 UTC).
const ANSWERED = Date.UTC(2026, 9, 20, 8, 59, 48);
const INCIDENT_SENTENCE = '1 service down · UPS on battery · 1 node in warning · 1 no signal';

// #330: the Overview's header, with Edit layout off and on.
function AppHeaderEditLayoutState() {
  const status = { state: 'ok', sentence: 'All 32 services up · 6 nodes healthy' };
  const updated = <UpdatedAgo at={ANSWERED} />;
  return (
    <Stack width={912}>
      <AppHeader
        status={status}
        updated={updated}
        onOpenPalette={noop}
        onThemeChange={noop}
        onEditLayout={noop}
      />
      <AppHeader
        status={status}
        updated={updated}
        onOpenPalette={noop}
        onThemeChange={noop}
        onEditLayout={noop}
        editingLayout
      />
    </Stack>
  );
}

function AppHeaderState() {
  return (
    <Stack width={912}>
      <AppHeader
        status={{ state: 'crit', sentence: INCIDENT_SENTENCE }}
        updated={<UpdatedAgo at={ANSWERED} />}
        onOpenPalette={noop}
        onThemeChange={noop}
        onLogout={noop}
      />
      <AppHeader
        name="Homelab"
        status={{ state: 'ok', sentence: 'All 32 services up · 6 nodes healthy' }}
        updated={<UpdatedAgo at={ANSWERED} />}
        onOpenPalette={noop}
        onThemeChange={noop}
        settingsCurrent
      />
      <AppHeader
        status={{ reach: 'down', state: 'crit', sentence: INCIDENT_SENTENCE }}
        updated={<UpdatedAgo at={ANSWERED - 168_000} />}
        onOpenPalette={noop}
        onThemeChange={noop}
        onLogout={noop}
      />
      <AppHeader
        status={{ reach: 'loading' }}
        onOpenPalette={noop}
        onThemeChange={noop}
        onLogout={noop}
      />
    </Stack>
  );
}

function AppHeaderFirstRunState() {
  return (
    <Stack width={912}>
      <AppHeader
        status={{ state: 'empty', sentence: 'Nothing monitored yet' }}
        updated={<UpdatedAgo at={ANSWERED} />}
        onOpenPalette={noop}
        onThemeChange={noop}
      />
    </Stack>
  );
}

// #480: no signal, with the last status known (the shell's usual case) and
// with none (no answer yet, or a 503 before the first check).
function AppHeaderNoSignalState() {
  return (
    <Stack width={912}>
      <AppHeader
        status={{
          reach: 'down',
          state: 'unknown',
          sentence: INCIDENT_SENTENCE,
          lastKnown: 'last known 2 min ago: Critical · 2 critical, 1 warning, 1 no signal',
        }}
        updated={<UpdatedAgo at={ANSWERED - 168_000} />}
        onOpenPalette={noop}
        onThemeChange={noop}
        onLogout={noop}
      />
      <AppHeader
        name="Homelab"
        status={{
          reach: 'waiting',
          state: 'unknown',
          sentence: 'All 32 services up · 6 nodes healthy',
          lastKnown: 'last known 3 min ago: All systems normal',
        }}
        updated={<UpdatedAgo at={ANSWERED - 168_000} />}
        onOpenPalette={noop}
        onThemeChange={noop}
      />
      <AppHeader
        status={{ reach: 'down' }}
        onOpenPalette={noop}
        onThemeChange={noop}
        onLogout={noop}
      />
    </Stack>
  );
}

const icon = (glyph) => createElement(glyph, { 'aria-hidden': 'true' });

/** The sidebar's groups, as the shell builds them (src/shell/nav.js). */
function shellGroups({ open = 'grafana', loaded = ['kuma', 'ha'], onUnload } = {}) {
  const apps = [
    ['arcane', 'Arcane'],
    ['grafana', 'Grafana'],
    ['ha', 'Home Assistant'],
    ['kuma', 'Uptime Kuma'],
  ];
  return [
    {
      id: 'monitor',
      label: 'Monitor',
      items: [
        { id: 'overview', label: 'Overview', href: '#overview', icon: icon(LayoutDashboard) },
        {
          id: 'alerts',
          label: 'Alerts',
          href: '#alerts',
          icon: icon(Bell),
          current: open === 'alerts',
          badge: { count: 4, state: 'crit', label: '4 issues' },
        },
      ],
    },
    {
      id: 'apps',
      label: 'Apps',
      items: [
        ...apps.map(([id, label]) => ({
          id,
          label,
          href: `#${id}`,
          monogram: appMonogram(label),
          current: open === id,
          loaded: loaded.includes(id),
          onUnload: loaded.includes(id) ? (onUnload ?? noop) : undefined,
        })),
        { id: 'add-app', label: 'Add app', href: '#add', icon: icon(Plus), minor: true },
      ],
    },
    {
      id: 'tools',
      label: 'Tools',
      items: [
        { id: 'settings', label: 'Settings', href: '#settings', icon: icon(SlidersHorizontal) },
      ],
    },
  ];
}

function SideNavState({ collapsed = false, open }) {
  return (
    <div style={{ height: 520, display: 'flex' }}>
      <SideNav groups={shellGroups({ open })} collapsed={collapsed} onCollapsedChange={noop} />
    </div>
  );
}

function BottomTabsState() {
  return (
    <Stack width={390}>
      <BottomTabs
        tabs={[
          { id: 'overview', label: 'Overview', href: '#overview', icon: icon(LayoutDashboard) },
          { id: 'services', label: 'Services', href: '#services', icon: icon(Activity) },
          {
            id: 'infrastructure',
            label: 'Infrastructure',
            short: 'Infra',
            href: '#infrastructure',
            icon: icon(Server),
          },
          {
            id: 'alerts',
            label: 'Alerts',
            href: '#alerts',
            icon: icon(Bell),
            current: true,
            badge: { count: 4, state: 'crit', label: '4 issues' },
          },
          { id: 'more', label: 'More', icon: icon(Ellipsis), onClick: noop },
        ]}
      />
    </Stack>
  );
}

// ---------------------------------------------------------------- the phone (#303)

const PHONE_PLATFORM = Object.freeze({ openTarget: noop });
const PHONE_NAV = Object.freeze({ push: noop, pop: noop });

/**
 * A phone screen as the web draws it below 768px (src/shell/PhoneView.jsx): a
 * 390px window, under the Phone board's header (#569), the board's 16px
 * gutter, on the mock's boards (phoneBoard.js). A detail is the sheet's
 * content, which fills the window, over the header.
 */
function PhoneScreenState({ Screen, data, params = {}, sheet = false, charts }) {
  const screen = (
    <PhonePlatform value={PHONE_PLATFORM}>
      {createElement(Screen, { data, nav: PHONE_NAV, params, charts })}
    </PhonePlatform>
  );
  if (sheet) return <div style={{ width: 390 }}>{screen}</div>;
  const { reach, status } = data;
  return (
    <div style={{ width: 390 }}>
      <PhoneHeader status={{ reach, ...status?.overall }} onThemeChange={noop} />
      <div style={{ padding: '12px 16px 24px' }}>{screen}</div>
    </div>
  );
}

/**
 * A phone board with the sheet's heartbeats for `uid` (#312), as PhoneDetail
 * gives them (`data.extras.beats`, entityExtras.js): the rest of the extras
 * left out, so the sheet keeps its own facts.
 */
const withBeats = (data, uid) => ({
  ...data,
  extras: { beats: decodeBeats(data.servicesBody.beats[uid]) },
});

/** The web's phone sheet for an entity the Incident detail draws (src/shell/PhoneDetail.jsx). */
function PhoneUpsSheet(props) {
  return <PhoneDetail screen="incident" {...props} />;
}

// #602: the sheet's history, the drawer's charts with the range switch sized
// for a thumb, as PhoneDetail gives it (HistoryCharts, from /api/history):
// here its answer, made up and repeatable. A week, 13 to 20 October 2026, a
// reading every 30 minutes, ending at the gallery's 09:00 UTC.
const WEEK_T0 = T0 + 60 * 60_000 - 7 * 24 * 60 * 60_000;
const week = (base, swing, phase) =>
  Array.from({ length: 337 }, (_, i) => ({
    time: WEEK_T0 + i * 30 * 60_000,
    value:
      Math.round(
        (base +
          swing * Math.sin((i / 48) * 2 * Math.PI + phase) +
          (swing / 4) * Math.sin(i * 0.9)) *
          10
      ) / 10,
  }));
const DAY_UTC = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const WEEK_CHART = {
  tickEvery: 24 * 60 * 60_000,
  formatTick: (t) => DAY_UTC.format(new Date(t)),
  formatTime: (t) => `${DAY_UTC.format(new Date(t))} ${new Date(t).toISOString().slice(11, 16)}`,
};

/** A node's sheet: its Usage (CPU, memory, disk) and Temperature over the last hour. */
const PHONE_NODE_HISTORY = (
  <DetailCharts
    size="touch"
    range="1h"
    ranges={RANGES}
    onRangeChange={noop}
    {...HOUR_CHART}
    charts={[
      {
        key: 'usage',
        title: 'Usage',
        label: 'Usage, last hour',
        series: CHART_USAGE,
        domain: [0, 100],
        formatValue: pct,
        state: 'ready',
      },
      {
        key: 'temperature',
        title: 'Temperature',
        label: 'Temperature, last hour',
        series: CHART_TEMP,
        domain: 'auto',
        formatValue: degrees,
        state: 'ready',
      },
    ]}
  />
);

/** A container's sheet: its CPU and Memory over the last 7 days. */
const PHONE_CONTAINER_HISTORY = (
  <DetailCharts
    size="touch"
    range="7d"
    ranges={RANGES}
    onRangeChange={noop}
    {...WEEK_CHART}
    charts={[
      {
        key: 'cpu',
        title: 'CPU',
        label: 'CPU, last 7 days',
        series: [{ key: 'cpu', name: 'CPU', points: week(6, 4, 0) }],
        domain: 'zero',
        formatValue: (v) => `${Math.round(v)} %`,
        state: 'ready',
      },
      {
        key: 'memory',
        title: 'Memory',
        label: 'Memory, last 7 days',
        series: [{ key: 'memory', name: 'Memory', points: week(420, 60, 1) }],
        domain: 'zero',
        formatValue: (v) => `${Math.round(v)} MB`,
        state: 'ready',
      },
    ]}
  />
);

// #569: below 768px the header is the Phone board's: the brand and the theme
// toggle. An instance's own name is cut short before it reaches the toggle.
function PhoneHeaderState() {
  return (
    <Stack width={390}>
      <PhoneHeader status={{ state: 'crit', sentence: INCIDENT_SENTENCE }} onThemeChange={noop} />
      <PhoneHeader
        name="The Bhandal homelab, upstairs rack"
        status={{ state: 'ok', sentence: 'All 32 services up · 6 nodes healthy' }}
        onThemeChange={noop}
      />
    </Stack>
  );
}

function AppBarState() {
  return (
    <Stack width={912}>
      <AppBar
        name="Grafana"
        url="https://grafana.example.com/d/homelab/overview"
        href="https://grafana.example.com/d/homelab/overview"
        onReload={noop}
      />
      <AppBar name="Uptime Kuma" url="http://kuma.lan:3001" onReload={noop} />
    </Stack>
  );
}

// A typed password, drawn as dots.
const TYPED = 'eight-ch'; // pragma: allowlist secret
const REJECTED = 'Wrong username or password.';

function LoginState({ busy = false }) {
  return busy ? <LoginForm username="admin" password={TYPED} busy /> : <LoginForm />;
}

function LoginErrorState({ form = false }) {
  return form ? (
    <LoginForm
      username="admin"
      password={TYPED}
      errors={{ form: "JagHelm didn't answer. Check the connection and try again." }}
    />
  ) : (
    <LoginForm username="admin" password={TYPED} errors={{ password: REJECTED }} />
  );
}

// ---------------------------------------------------------------- the alert history (#314)

/** A row's link to its entity, as the Alerts page gives it (an entity's URL, #309). */
const alertLink = (id) => ({ href: `/alerts?entity=${id}`, onOpen: noop });
const ALERT_BOARD = phoneBoard('incident');
const ALERT_DAYS = historyView(ALERT_EVENTS, ALERT_BOARD.status, ALERTS_NOW, alertLink);
/** History as useAlertHistory gives it: read, with older pages to load. */
const HISTORY_READ = Object.freeze({
  state: 'ok',
  events: ALERT_EVENTS,
  more: noop,
  loadingMore: false,
  failed: false,
  retry: noop,
});

/**
 * Below 672px, a row whose name and change are both long: the name whole,
 * wrapping, the change on the next line (an EntityRow's rule, #314).
 */
const LONG_NAME_EVENTS = [
  {
    id: '90',
    at: new Date(ALERTS_NOW - 6 * 24 * 60 * 60_000).toISOString(),
    type: 'host_recovered',
    severity: 'info',
    entity: 'nodes/basement-nas',
    title: 'Host recovered',
    body: 'Network Attached Storage in the basement rack · Healthy',
    reason: 'Healthy',
    node: 'basement-nas',
    key: 'basement-nas',
    push: { state: 'sent', phones: 2, suppressed: 0 },
  },
];
const LONG_NAME_DAYS = historyView(
  [...ALERT_EVENTS, ...LONG_NAME_EVENTS],
  ALERT_BOARD.status,
  ALERTS_NOW,
  alertLink
);

function AlertHistoryState({ width, days = ALERT_DAYS }) {
  return (
    <div style={{ width }}>
      <AlertHistory days={days} onMore={noop} />
    </div>
  );
}

const SEVERITY_ITEMS = [
  { value: 'all', label: 'All' },
  { value: 'critical', label: 'Critical' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
];
const KIND_ITEMS = [
  { value: 'all', label: 'Everything' },
  { value: 'services', label: 'Services' },
  { value: 'nodes', label: 'Nodes' },
  { value: 'power', label: 'Power' },
];

function AlertFiltersState() {
  const common = {
    severities: SEVERITY_ITEMS,
    kinds: KIND_ITEMS,
    onSeverity: noop,
    onKind: noop,
    onSearch: noop,
  };
  return (
    <Stack width={912} gap={24}>
      <AlertFilters {...common} severity="all" kind="all" search="" />
      <AlertFilters {...common} severity="warning" kind="nodes" search="jagnas" onClear={noop} />
    </Stack>
  );
}

function AlertHistoryStatesState() {
  const today = [{ ...ALERT_DAYS[0], rows: ALERT_DAYS[0].rows.slice(0, 2) }];
  return (
    // Each its own region name, as five on one page must be told apart.
    <Stack width={720} gap={24}>
      <AlertHistory state="loading" aria-label="History, loading" />
      <AlertHistory
        days={[]}
        empty="No alerts in the last 30 days. Every change is recorded here, whether or not push is set up."
        aria-label="History, nothing in 30 days"
      />
      <AlertHistory state="old" aria-label="History, an older server" />
      <AlertHistory state="error" onRetry={noop} aria-label="History, unavailable" />
      <AlertHistory days={today} failed onRetry={noop} aria-label="History, a refresh failed" />
    </Stack>
  );
}

/**
 * The Alerts page's content at 912px (its title is the shell's ShellPage), on
 * the incident. Filtered, History is what the server sends for the filters:
 * the events of that severity and kind, all of them in one page.
 */
function AlertsPageState({ filters = NO_FILTERS }) {
  const history =
    filters === NO_FILTERS
      ? HISTORY_READ
      : {
          ...HISTORY_READ,
          more: null,
          events: ALERT_EVENTS.filter(
            (e) => e.severity === filters.severity && e.entity?.startsWith(`${filters.kind}/`)
          ),
        };
  return (
    <Stack width={912} gap={24}>
      <AlertsContent
        status={ALERT_BOARD.status}
        reach="ok"
        updated={ALERT_BOARD.updated}
        filters={filters}
        onFilters={noop}
        history={history}
        linkOf={alertLink}
        now={ALERTS_NOW}
      />
    </Stack>
  );
}

/** The phone's Alerts tab, in the web's look (src/phone/views/Alerts.jsx), on the incident. */
function PhoneAlertsScreen({ data, nav }) {
  return (
    <WebAlertsView
      data={data}
      nav={nav}
      filters={NO_FILTERS}
      onFilters={noop}
      history={HISTORY_READ}
      now={ALERTS_NOW}
    />
  );
}

// ---------------------------------------------------------------- settings

// Settings' sections (#317) as the index and the list draw them: the app's
// list, each with its module's icon (src/components/settings/sections/).
const SETTINGS_ICONS = {
  sources: <Database />,
  nodes: <Server />,
  integrations: <Plug />,
  apps: <LayoutGrid />,
  notifications: <Bell />,
  appearance: <Palette />,
  system: <ShieldCheck />,
};
const SETTINGS_CARDS = SETTINGS_SECTIONS.map((s) => ({
  id: s.id,
  label: s.label,
  description: s.desc,
  icon: SETTINGS_ICONS[s.id],
  href: `#settings-${s.id}`,
}));

function SettingsIndexState({ query = '', sections = SETTINGS_CARDS }) {
  return (
    <Stack width={880}>
      <SettingsIndex query={query} onQueryChange={noop} sections={sections} />
    </Stack>
  );
}

// "link": Apps & links, by its name and two of its settings.
const SETTINGS_FOUND = SETTINGS_CARDS.filter((s) => s.id === 'apps').map((s) => ({
  ...s,
  hits: ['Quick Launch links', 'Where links open'],
}));

function SettingsSectionState() {
  const appearance = SETTINGS_CARDS.find((s) => s.id === 'appearance');
  return (
    <Stack width={880}>
      <SettingsSectionPage
        title={appearance.label}
        description={appearance.description}
        indexHref="#settings"
        nav={<SettingsNav sections={SETTINGS_CARDS} current="appearance" />}
      >
        <Panel
          title="The section's own content"
          description="Today's Settings markup, until the section's card rebuilds it"
        >
          <p style={{ color: 'var(--jh-text-2)' }}>Theme, font, branding and the rest.</p>
        </Panel>
      </SettingsSectionPage>
    </Stack>
  );
}

// Settings → Appearance (#321): the section as the app draws it, over a
// display config held here, so its controls work. Its theme, accent and
// density are the variant's, so what is chosen is what is drawn.
const APPEARANCE_CONFIG = {
  title: 'JAGHELM',
  weatherLat: '39.88',
  weatherLon: '-83.09',
  weatherCity: 'Grove City',
  sections: { pipeline: { visible: false } },
  overviewSections: { power: false },
};

function AppearanceSection({ extra }) {
  const around = useContext(RootSwitchesContext) ?? {};
  const [config, setConfig] = useState(() => ({
    ...APPEARANCE_CONFIG,
    accent: around['data-accent'] ?? 'violet',
    density: around['data-density'] ?? 'comfortable',
    ...extra,
  }));
  return (
    <ConfigProvider config={config} setConfig={setConfig}>
      <Appearance theme={around['data-theme'] ?? 'dark'} setTheme={noop} />
    </ConfigProvider>
  );
}

// Custom themes (#331): the example theme from the docs (valid), one whose
// secondary text is too dim (rejected, with the pairing named), and a light one.
const THEME_MIDNIGHT = midnightTheme;
const THEME_DIM = {
  ...midnightTheme,
  id: 'dim',
  name: 'Dim',
  tokens: { ...midnightTheme.tokens, 'text-2': 'oklch(0.5 0.02 255)' },
};
const THEME_PAPER = { id: 'paper', name: 'Paper', base: 'light', tokens: { bg: '#fafafb' } };

/** Theme card, Custom themes panel and the list: one theme loaded, one rejected. */
function ThemesPanelState() {
  const [config, setConfig] = useState({ themes: [THEME_MIDNIGHT, THEME_PAPER, THEME_DIM] });
  return (
    <Stack width={720}>
      <Panel title="Theme" description="Dark, light, the device’s own setting, or a custom theme.">
        <ThemeChoice
          aria-label="Theme"
          value="custom:dark:midnight"
          options={[
            { value: 'dark', label: 'Dark', description: 'Graphite, for dim rooms' },
            { value: 'light', label: 'Light', description: 'For bright rooms' },
            { value: 'system', label: 'System', description: 'Follows the device' },
            ...[THEME_MIDNIGHT, THEME_PAPER].map((t) => ({
              value: `custom:${t.base}:${t.id}`,
              label: t.name,
              description: `Custom, ${t.base} base`,
              base: t.base,
              vars: themeVars(t.tokens),
            })),
          ]}
        />
      </Panel>
      <CustomThemesPanel
        config={config}
        library={validateThemes(config.themes)}
        edit={(change) => setConfig((prev) => ({ ...prev, themes: change(prev.themes) }))}
      />
    </Stack>
  );
}

/** The form with a pasted theme: `which` is the text in the box. */
function ThemesImportState({ text }) {
  return (
    <Stack width={720}>
      <CustomThemesPanel
        config={{}}
        library={{ valid: [], rejected: [] }}
        edit={noop}
        defaultText={text}
      />
    </Stack>
  );
}

/** A screen drawn in a custom theme: what its roles look like together. */
function ThemedScreenState({ theme }) {
  return (
    <UiRoot theme={theme.base} themeVars={themeVars(theme.tokens)} style={{ width: 560 }}>
      <Stack gap={12}>
        <Panel title={`${theme.name} theme`} description="Secondary text sits on a panel.">
          <p style={{ color: 'var(--jh-text-1)' }}>vm-103 is healthy</p>
          <p style={{ color: 'var(--jh-text-2)' }}>Nine of ten services answered in under 40 ms.</p>
          <p style={{ color: 'var(--jh-text-3)' }}>Updated 4 minutes ago</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Button>Save</Button>
            <Button variant="secondary">Cancel</Button>
          </div>
        </Panel>
        <Banner tone="warn" title="Backups are late" cause="The nightly job has not reported since 03:00." />
      </Stack>
    </UiRoot>
  );
}

// LayoutEditor (#330): Edit layout's panel, as the Overview draws it above its
// sections: Services moved up, Jobs hidden, one service pinned, a group made
// with a service in it, the rest to pin from.
const EDIT_SECTIONS = [
  { id: 'attention', label: 'Needs attention', hint: 'Always on, always first', shown: true, locked: true, movable: false },
  { id: 'strip', label: 'Subsystem strip', hint: 'Stays under Needs attention', shown: true, movable: false },
  { id: 'services', label: 'Services', shown: true },
  { id: 'infrastructure', label: 'Infrastructure', shown: true },
  { id: 'power', label: 'Power', shown: true },
  { id: 'jobs', label: 'Jobs', shown: false },
  { id: 'rail', label: 'Utilities rail', hint: 'Beside the sections, from 1440px', shown: true, movable: false },
];
const EDIT_GROUPS = [
  { value: GROUP_NONE, label: 'No group' },
  { value: 'network', label: 'Network' },
];
const EDIT_PINNED = [{ id: 'pi-2:unbound', name: 'Unbound', where: 'Pi 2', group: GROUP_NONE }];
const EDIT_SERVICES = [
  { id: 'pi-1:adguard-home', name: 'AdGuard Home', where: 'Pi 1', group: 'network' },
  { id: 'pi-1:home-assistant', name: 'Home Assistant', where: 'Pi 1', group: GROUP_NONE },
  { id: 'pi-2:vaultwarden', name: 'Vaultwarden', where: 'Pi 2', group: GROUP_NONE },
];

function LayoutEditorState({ width = 760 }) {
  return (
    <Stack width={width}>
      <LayoutEditor
        sections={EDIT_SECTIONS}
        pinned={EDIT_PINNED}
        services={EDIT_SERVICES}
        groups={EDIT_GROUPS}
        onDone={noop}
      />
    </Stack>
  );
}

/**
 * One typeface (#660): the Font family cards with `face` chosen, and text,
 * figures and a path drawn in a root that carries `data-typeface`, as every
 * root of the app does once Settings saves the choice.
 */
function TypefaceState({ face }) {
  return (
    <UiRoot typeface={face.id} style={{ width: 640 }}>
      <Stack gap={16}>
        <Panel title="Font family" description="The typeface of JagHelm’s text.">
          <FontChoice
            aria-label="Font family"
            options={TYPEFACES.map((t) => ({
              value: t.id,
              label: t.label,
              description: t.id === TYPEFACES[0].id ? 'The default' : undefined,
              family: `'${t.family}', ui-sans-serif, system-ui, sans-serif`,
            }))}
            value={face.id}
          />
        </Panel>
        <div>
          <p style={{ fontSize: 20, fontWeight: 700, color: 'var(--jh-text-1)' }}>
            vm-103 is healthy
          </p>
          <p style={{ fontSize: 14, color: 'var(--jh-text-2)' }}>
            Nine of ten services answered in under 40 ms; backups ran at 03:00 on 24 Oct.
          </p>
          <p
            style={{
              fontFamily: 'var(--jh-font-mono)',
              fontSize: 13,
              color: 'var(--jh-text-3)',
            }}
          >
            /opt/stacks/immich 9cf5d181
          </p>
        </div>
      </Stack>
    </UiRoot>
  );
}

/** Settings → Appearance at 880px, in its section's page. */
function SettingsAppearanceState() {
  const appearance = SETTINGS_CARDS.find((s) => s.id === 'appearance');
  return (
    <Stack width={880}>
      <SettingsSectionPage
        title={appearance.label}
        description={appearance.description}
        indexHref="#settings"
        nav={<SettingsNav sections={SETTINGS_CARDS} current="appearance" />}
      >
        <AppearanceSection />
      </SettingsSectionPage>
    </Stack>
  );
}

// Settings → Apps & links (#362): the section as the app draws it, over a
// display config held here, with the embedding check answered from a table
// (no request): one app embeds, one blocks, one could not be read, and one
// opens in a new browser tab.
const APPS_CONFIG = {
  tabs: [
    { id: 'arcane', label: 'Arcane', type: 'iframe', url: 'https://arcane.lan' },
    { id: 'grafana', label: 'Grafana', type: 'iframe', url: 'https://grafana.lan' },
    { id: 'kuma', label: 'Uptime Kuma', type: 'iframe', url: 'https://kuma.lan' },
    { id: 'vault', label: 'Vaultwarden', type: 'iframe', url: 'https://vault.lan', newTab: true },
  ],
  links: {
    personal: [
      { name: 'Nextcloud', url: 'https://cloud.lan', icon: '☁️' },
      { name: 'Immich', url: 'https://photos.lan', icon: '📷' },
    ],
    management: [],
    devops: [
      { name: 'Proxmox', url: 'https://pve.lan:8006', icon: '🖥️' },
      { name: 'Gitea', url: 'https://git.lan', icon: '🔗' },
    ],
    media: [{ name: 'Jellyfin', url: 'https://jellyfin.lan', icon: '🎬' }],
  },
  linkTarget: '_blank',
  searchEngine: 'duckduckgo',
};
const APPS_CHECKS = {
  'https://arcane.lan': { verdict: 'allowed' },
  'https://grafana.lan': { verdict: 'blocked', header: 'X-Frame-Options: DENY' },
  'https://kuma.lan': { verdict: 'unknown', reason: 'timed out' },
};
const checkApp = async (url) => APPS_CHECKS[url] ?? { verdict: 'allowed' };

function AppsSection({ initial = null }) {
  const [config, setConfig] = useState(APPS_CONFIG);
  return (
    <OverlayProvider>
      <ConfigProvider config={config} setConfig={setConfig}>
        <AppsLinks checkEmbed={checkApp} checkSaved={checkApp} initial={initial} />
      </ConfigProvider>
    </OverlayProvider>
  );
}

/** Settings → Apps & links at 880px, in its section's page. */
function SettingsAppsState() {
  const apps = SETTINGS_CARDS.find((s) => s.id === 'apps');
  return (
    <Stack width={880}>
      <SettingsSectionPage
        title={apps.label}
        description={apps.description}
        indexHref="#settings"
        nav={<SettingsNav sections={SETTINGS_CARDS} current="apps" />}
      >
        <AppsSection />
      </SettingsSectionPage>
    </Stack>
  );
}

/** The add form at a phone's width, after the check found the site blocks embedding. */
function SettingsAppsBlockedState() {
  const app = {
    id: 'paperless',
    label: 'Paperless',
    type: 'iframe',
    url: 'https://paperless.lan',
  };
  return (
    <Stack width={390}>
      <AppsSection
        initial={{
          form: { label: 'Paperless', url: 'paperless.lan', icon: '', newTab: false },
          phase: { app, result: { verdict: 'blocked', header: 'X-Frame-Options: DENY' } },
        }}
      />
    </Stack>
  );
}

// Settings → Notifications (#320): the thresholds as the editor draws them
// (the disk set away from its defaults), the categories, and the phones as
// GET /api/push/devices gives them, by the gallery's clock (GALLERY_NOW).
const THRESHOLD_LINES = [
  ['cpu', '%', '90', null, { warn: 90, crit: null }],
  ['mem', '%', '90', null, { warn: 90, crit: null }],
  ['disk', '%', '88', '94', { warn: 90, crit: 95 }],
  ['temp', '°C', '75', '85', { warn: 75, crit: 85 }],
];
const thresholdRows = (errors = {}) =>
  THRESHOLD_LINES.map(([metric, unit, warn, crit, defaults]) => ({
    metric,
    ...METRIC_WORDS[metric],
    unit,
    warn: errors[metric]?.warn ?? warn,
    crit,
    defaults,
    custom: Number(warn) !== defaults.warn || (crit == null ? null : Number(crit)) !== defaults.crit,
    error: errors[metric]?.error ?? null,
  }));
const THRESHOLDS_DESCRIPTION =
  'The board and push judge every node by these lines. A level holds until the reading falls 5 points (5 °C) under its line.';
const hoursAgo = (h) => new Date(GALLERY_NOW - h * 3_600_000).toISOString();
const PUSH_PREFS = {
  enabled: true,
  notifyRecoveries: true,
  categories: { service: true, host: true, ups: true, cron: true, watchtower: true },
};
const PHONES = [
  {
    id: '3f9a1c77e0b2',
    name: 'Pixel 8',
    platform: 'web',
    registeredAt: hoursAgo(12 * 24),
    lastSeenAt: hoursAgo(2),
    lastDeliveredAt: hoursAgo(0.01),
    lastError: null,
    prefs: PUSH_PREFS,
  },
  {
    id: '8c2d4e6f0a1b',
    name: 'Galaxy Tab S9',
    platform: 'web',
    registeredAt: hoursAgo(40 * 24),
    lastSeenAt: hoursAgo(26),
    lastDeliveredAt: hoursAgo(26),
    lastError: {
      at: hoursAgo(20),
      sentence: "The browser's push service failed on it; JagHelm tries again",
    },
    prefs: { ...PUSH_PREFS, enabled: false },
  },
  // A browser with alerts on (#653): a name and a time.
  {
    id: 'b71e90c2d4a8',
    name: 'Pixel 8 (Chrome)',
    platform: 'web',
    registeredAt: hoursAgo(3),
    lastSeenAt: hoursAgo(3),
    lastDeliveredAt: hoursAgo(0.01),
    lastError: null,
    prefs: PUSH_PREFS,
  },
];
const PHONES_TEST = {
  at: hoursAgo(0.01),
  device: null,
  done: true,
  sentence: 'Delivered to 2 of 3 phones.',
  results: [
    {
      device: 'b71e90c2d4a8',
      state: 'sent',
      sentence: "Delivered: the browser's push service accepted it. It shows unless JagHelm is open on screen.",
    },
    {
      device: '3f9a1c77e0b2',
      state: 'sent',
      sentence:
        "Delivered: the browser's push service accepted it. It shows unless JagHelm is open on screen.",
    },
    {
      device: '8c2d4e6f0a1b',
      state: 'off',
      sentence: 'Not sent: push is switched off for this device.',
    },
  ],
};

/** Settings → Notifications at 880px, push on with two phones, in its section's page. */
function SettingsNotificationsState() {
  const notifications = SETTINGS_CARDS.find((s) => s.id === 'notifications');
  return (
    <Stack width={880}>
      <SettingsSectionPage
        title={notifications.label}
        description={notifications.description}
        indexHref="#settings"
        nav={<SettingsNav sections={SETTINGS_CARDS} current="notifications" />}
      >
        <Stack gap={24}>
          <ThresholdTable
            description={THRESHOLDS_DESCRIPTION}
            rows={thresholdRows()}
            onChange={noop}
            onReset={noop}
            onSave={noop}
            onDiscard={noop}
          />
          <PushCategories defaults={PUSH_PREFS} />
          <WebPushDevice state="on" name="Pixel 8 (Chrome)" onEnable={noop} onDisable={noop} onTest={noop} />
          <PushDevices enabled devices={PHONES} test={PHONES_TEST} now={GALLERY_NOW} onTest={noop} onRemove={noop} />
        </Stack>
      </SettingsSectionPage>
    </Stack>
  );
}

/** Alerts on this device (#653) at a phone's width: off, ready to enable; and on, after a test alert. */
function WebPushDeviceState() {
  return (
    <Stack width={390} gap={24}>
      <WebPushDevice title="Alerts on this device: Off" state="off" onEnable={noop} onDisable={noop} onTest={noop} />
      <WebPushDevice title="Alerts on this device: On"
        state="on"
        name="Pixel 8 (Chrome)"
        test="Delivered: the browser's push service accepted it. It shows unless JagHelm is open on screen."
        onEnable={noop}
        onDisable={noop}
        onTest={noop}
      />
    </Stack>
  );
}

/** Alerts on this device at a phone's width, where it cannot be turned on: each reason in words. */
function WebPushProblemsState() {
  return (
    <Stack width={390} gap={24}>
      <WebPushDevice title="Alerts on this device: Blocked" state="denied" />
      <WebPushDevice title="Alerts on this device: Not installed" state="install" />
      <WebPushDevice title="Alerts on this device: Unsupported" state="unsupported" />
      <WebPushDevice title="Alerts on this device: Server off" state="server-off" reason="unset" />
      <WebPushDevice title="Alerts on this device: Expired"
        state="expired"
        notice={{ tone: 'error', text: "Couldn't turn alerts on. Couldn't reach the browser's push service." }}
        onEnable={noop}
      />
    </Stack>
  );
}

/** Alerts that were on stopped (#653): the notice over the top of the page. */
function AlertsStoppedState() {
  return (
    <Stack width={390}>
      <div style={{ position: 'relative', height: 140 }}>
        <div style={{ position: 'absolute', inset: 0, transform: 'translate(0, 0)' }}>
          <AlertsStopped onTurnOn={noop} />
        </div>
      </div>
    </Stack>
  );
}

/** Cloudflare Access wants a sign-in again (#653): the notice over the top of the page. */
function AccessExpiredState() {
  return (
    <Stack width={390}>
      <div style={{ position: 'relative', height: 140 }}>
        <div style={{ position: 'absolute', inset: 0, transform: 'translate(0, 0)' }}>
          <AccessExpired onReload={noop} />
        </div>
      </div>
    </Stack>
  );
}

/**
 * At a phone's width: a colour the old picker saved, mapped to Violet, the
 * nearest of the three, and the Accent panel saying so.
 */
function SettingsAppearanceNoticeState() {
  return (
    <Stack width={390}>
      <AppearanceSection extra={{ accentNotice: { from: '#3b82f6', to: 'violet' } }} />
    </Stack>
  );
}

// Settings → System → Energy cost (#743): the part over a display config held
// here: no rate yet, two rates (the newest is the current one), and a phone's
// width with a price over the limit, a repeated date and a symbol too long.
const ENERGY_SAVED = {
  energy: {
    currency: '£',
    rates: [
      { from: '2025-09-01', perKwh: 0.14 },
      { from: '2026-04-01', perKwh: 0.2475 },
    ],
  },
};
const ENERGY_BAD = {
  currency: 'POUND',
  rates: [
    { key: 0, from: '2025-09-01', price: '0.14' },
    { key: 1, from: '2026-04-01', price: '11' },
    { key: 2, from: '2026-04-01', price: '0.2' },
  ],
};

// Today's Settings cards read the page's own light/dark colours (set on <html>
// by the app), which the gallery's per-variant roots do not set, so this
// state maps the few it uses onto the variant's tokens.
const LEGACY_COLOURS = {
  '--text-primary': 'var(--jh-text-1)',
  '--text-secondary': 'var(--jh-text-2)',
  '--text-muted': 'var(--jh-text-3)',
  '--bg-card': 'var(--jh-surface-1)',
  '--bg-card-inner': 'var(--jh-surface-2)',
  '--glass-border': 'var(--jh-border-subtle)',
  '--border-color': 'var(--jh-border-strong)',
  '--red': 'var(--jh-crit-fg)',
  '--accent': 'var(--jh-accent)',
  '--accent-glow': 'var(--jh-accent-tint)',
};

function EnergyState({ config = {}, initial = null, width = 880, page = true }) {
  const [cfg, setCfg] = useState(config);
  const system = SETTINGS_CARDS.find((s) => s.id === 'system');
  const part = (
    <OverlayProvider>
      <ConfigProvider config={cfg} setConfig={setCfg}>
        <SettingsPart>
          <div style={LEGACY_COLOURS}>
            <Group
              title="Energy cost"
              id="energy-cost"
              description="What a kilowatt-hour costs you, for the Monitoring cost chart."
            >
              <EnergyCost initial={initial} />
            </Group>
          </div>
        </SettingsPart>
      </ConfigProvider>
    </OverlayProvider>
  );
  return (
    <Stack width={width}>
      {page ? (
        <SettingsSectionPage
          title={system.label}
          description={system.description}
          indexHref="#settings"
          nav={<SettingsNav sections={SETTINGS_CARDS} current="system" />}
        >
          {part}
        </SettingsSectionPage>
      ) : (
        part
      )}
    </Stack>
  );
}

// Settings → Integrations (#323): the Connected list as the status model words
// each row, the gallery, and one form with a refusal beside its field.
const INTEGRATION_ROWS = [
  {
    id: 'adguard_primary',
    name: 'AdGuard Home (primary)',
    kind: 'Preset',
    url: 'http://adguard.lab:3000',
    target: 'adguard',
    state: 'ok',
    word: 'OK',
    enabled: true,
  },
  {
    id: 'proxmox',
    name: 'Proxmox VE',
    kind: 'Preset',
    url: 'https://pve.lab:8006',
    state: 'warn',
    word: 'Failing',
    error: "Proxmox VE: its address refused the connection; check it's running and the URL is right",
    enabled: true,
  },
  {
    id: 'statuspage',
    name: 'statuspage',
    kind: 'Custom',
    url: 'http://status.lab',
    state: 'ok',
    word: 'OK',
    enabled: true,
    notes: ['Endpoint and fields are set in services.yaml.'],
  },
  {
    id: 'gotify',
    name: 'Gotify',
    kind: 'Preset',
    url: 'http://gotify.lab',
    state: null,
    word: 'Disabled',
    enabled: false,
  },
];
const PRESET_TILES = [
  ['adguard', 'AdGuard Home', 'DNS ad-blocking stats', true],
  ['grafana', 'Grafana', 'Dashboards and firing alerts', false],
  ['gitea', 'Gitea', 'Repositories and open issues', false],
  ['immich', 'Immich', 'Photos and storage', false],
  ['jellyfin', 'Jellyfin', 'Streams and library size', false],
  ['proxmox', 'Proxmox VE', 'Pools and guests', true],
].map(([type, name, description, configured]) => ({ type, name, description, configured }));
const PRESET_CATEGORY_ITEMS = [
  { value: 'all', label: 'All (41)' },
  { value: 'dns', label: 'DNS & Ad Blocking (3)' },
  { value: 'infra', label: 'Infrastructure (4)' },
];

/** Settings → Integrations at 880px: four integrations (one failing, one off) and the presets. */
function SettingsIntegrationsState() {
  const integrations = SETTINGS_CARDS.find((s) => s.id === 'integrations');
  return (
    <Stack width={880}>
      <SettingsSectionPage
        title={integrations.label}
        description={integrations.description}
        indexHref="#settings"
        nav={<SettingsNav sections={SETTINGS_CARDS} current="integrations" />}
      >
        <Stack gap={24}>
          <IntegrationList rows={INTEGRATION_ROWS} onToggle={noop} onEdit={noop} onRemove={noop} />
          <PresetGallery
            presets={PRESET_TILES}
            total={41}
            categories={PRESET_CATEGORY_ITEMS}
            onPick={noop}
            onCustom={noop}
          />
        </Stack>
      </SettingsSectionPage>
    </Stack>
  );
}

/** At a phone's width: nothing set up yet, and the presets below. */
function SettingsIntegrationsEmptyState() {
  return (
    <Stack width={390} gap={24}>
      <IntegrationList rows={[]} onAdd={noop} />
      <PresetGallery
        presets={PRESET_TILES.slice(0, 3)}
        total={41}
        categories={PRESET_CATEGORY_ITEMS}
        onPick={noop}
        onCustom={noop}
      />
    </Stack>
  );
}

/** Editing AdGuard Home: the URL refused for a credential beside it, a failed test, a stored password kept. */
function SettingsIntegrationsFormState() {
  return (
    <Stack width={720}>
      <IntegrationForm
        title="Edit AdGuard Home (primary)"
        description="DNS ad-blocking stats · Auth: Basic Auth (Username + Password)"
        backLabel="Back to Connected"
        onBack={noop}
        fields={[
          {
            id: 'url',
            label: 'Base URL',
            description: 'The protocol is added if missing: adguard.local:3000 becomes http://adguard.local:3000.',
            value: 'http://admin:****@adguard.lab:3000',
            onChange: noop,
            error:
              'The URL carries a password or key; enter the URL without it, and the credential in its own field.',
            mono: true,
            wide: true,
          },
          { id: 'instance', label: 'Instance name', value: 'primary', onChange: noop, mono: true },
          {
            id: 'target',
            kind: 'select',
            label: 'Target container',
            value: 'pi1:adguard',
            items: [
              { value: '', label: 'Auto-match (by name)' },
              { value: 'pi1:adguard', label: 'adguard — pi1' },
            ],
            onChange: noop,
          },
          { id: 'username', label: 'Username', value: 'admin', onChange: noop },
          {
            id: 'password',
            kind: 'secret',
            label: 'Password',
            description: 'Stored encrypted on the server. Leave blank to keep it.',
            value: '',
            placeholder: '••••••••',
            onChange: noop,
          },
          {
            id: 'enabled',
            kind: 'check',
            label: 'Enabled',
            description: 'Fetch its data on every refresh.',
            value: true,
            onChange: noop,
            wide: true,
          },
        ]}
        dataFields={['Queries today', 'Blocked', 'Block rate']}
        test={{ state: 'failed', sentence: 'HTTP 401 Unauthorized' }}
        onTest={noop}
        onSave={noop}
        remove={{ name: 'AdGuard Home (primary)', detail: 'Preset', value: 'adguard_primary', onRemove: noop }}
      />
    </Stack>
  );
}

// Settings → Sources (#318): the status model's sources and the cron store's
// jobs, as /api/status says them, by the gallery's clock (GALLERY_NOW), the
// status built 12 s before it.
const SOURCES_AT = GALLERY_NOW - 12_000;
const minutesAgo = (m) => GALLERY_NOW - m * 60_000;
const reported = (id, word = 'OK', state = 'ok', more = {}) => ({
  id: `jobs/apps:${id}`,
  kind: 'job',
  subsystem: 'jobs',
  name: id,
  node: 'apps',
  state,
  word,
  lastRun: minutesAgo(4),
  overdue: false,
  ...more,
});
// A subsystem as the model counts it: `n` members, its sub the strip's words.
const subsystem = (id, name, state, n, sub) => ({
  id,
  name,
  state,
  counts: { total: n },
  value: `${state === 'ok' ? n : n - 2} / ${n}`,
  sub,
});
const SOURCES_OK = {
  sources: Object.fromEntries(
    ['prometheus', 'kuma', 'nut', 'gitea'].map((id) => [id, { state: 'ok', since: minutesAgo(200) }])
  ),
  issues: [],
  entities: [
    ...['db-dump', 'image-prune', 'certs-renew', 'scrub-check'].map((id) => reported(id)),
    {
      ...reported('nightly-backup'),
      id: 'backups/apps:nightly-backup',
      kind: 'backup',
      subsystem: 'backups',
    },
  ],
  subsystems: [
    subsystem('jobs', 'Jobs', 'ok', 4, 'OK'),
    subsystem('backups', 'Backups', 'ok', 1, 'OK'),
  ],
};
const PROMETHEUS_DOWN = "Prometheus didn't answer: the connection was refused";
const CONFIG_PROBLEM = "services.yaml doesn't parse (line 12)";
const SOURCES_FAILED = {
  sources: {
    prometheus: { state: 'failed', error: PROMETHEUS_DOWN, since: minutesAgo(4) },
    kuma: { state: 'ok', since: minutesAgo(180) },
    nut: { state: 'ok', since: minutesAgo(180) },
    config: { state: 'failed', error: CONFIG_PROBLEM, since: minutesAgo(9) },
  },
  issues: [
    {
      id: 'sources/prometheus',
      kind: 'source',
      state: 'warn',
      word: 'Failed',
      reason: PROMETHEUS_DOWN,
      since: minutesAgo(4),
    },
  ],
  entities: [
    reported('db-dump'),
    reported('image-prune', 'Failed', 'warn', { lastRun: minutesAgo(62) }),
    reported('certs-renew', 'Overdue', 'warn', { lastRun: minutesAgo(3000), overdue: true }),
  ],
  subsystems: [subsystem('jobs', 'Jobs', 'warn', 3, '1 failed · 1 overdue')],
};
const sourcesOf = (status) =>
  [
    configRow({ status, at: SOURCES_AT, href: '#settings-nodes' }),
    ...sourceRows({ status, at: SOURCES_AT }),
    cronRow({ status, at: SOURCES_AT, jobsHref: () => '#jobs' }),
  ].filter(Boolean);
// Settings → Nodes & Services (#319): the services by node with the monitor tag
// each really has, one row open on the Auto-match suggestion, and the backup jobs.
const mappedRow = (container, name, tag, more = {}) => ({
  id: `vm-103:${container}`,
  sub: container,
  name,
  state: 'ok',
  stateWord: 'Up',
  hidden: false,
  overridden: false,
  tag,
  editing: false,
  editor: null,
  ...more,
});
const MONITOR_ITEMS = [
  { value: '__auto__', label: 'Auto-match (Loki)' },
  { value: '__none__', label: 'No monitor' },
  { value: 'Gitea', label: 'Gitea' },
  { value: 'Loki', label: 'Loki' },
  { value: 'Loki Push', label: 'Loki Push' },
];
const SERVICE_NODES = [
  {
    key: 'vm-103',
    name: 'vm-103',
    icon: '🖥',
    color: '#8b5cf6',
    count: 4,
    open: true,
    services: [
      mappedRow('gitea', 'Gitea', { kind: 'monitored', monitor: 'Gitea' }),
      mappedRow('loki', 'Loki', { kind: 'none' }, {
        editing: true,
        overridden: true,
        editor: {
          name: '',
          namePlaceholder: 'Loki',
          icon: '',
          monitor: '__auto__',
          monitorItems: MONITOR_ITEMS,
          suggestion: { monitor: 'Loki', why: 'exact' },
          candidates: [
            { name: 'Loki', kind: 'exact' },
            { name: 'Loki Push', kind: 'contains', heldBy: { container: 'loki-push', node: 'Pi 1' } },
          ],
        },
      }),
      mappedRow('watchtower', 'Watchtower', { kind: 'opted-out' }, { overridden: true }),
      mappedRow('immich-redis', 'Immich Redis', { kind: 'none' }, { hidden: true, state: 'unknown', stateWord: 'No signal' }),
    ],
  },
  {
    key: 'pi-1',
    name: 'Pi 1',
    icon: '🖥',
    color: '#06b6d4',
    count: 2,
    open: false,
    services: [],
  },
];
const BACKUP_ROWS = [
  { key: 'nas:b2-sync', node: 'nas', job: 'b2-sync', backup: true, reporting: true },
  { key: 'pve:proxmox-backup', node: 'pve', job: 'proxmox-backup', backup: true, reporting: true },
  { key: 'pve:trim', node: 'pve', job: 'trim', backup: false, reporting: true },
  { key: 'old:gone', node: 'old', job: 'gone', backup: true, reporting: false },
];

/** Settings → Nodes & Services at 880px: Loki open on its suggestion, and the backup jobs. */
function SettingsServicesState() {
  const nodes = SETTINGS_CARDS.find((s) => s.id === 'nodes');
  return (
    <Stack width={880}>
      <SettingsSectionPage
        title={nodes.label}
        description={nodes.description}
        indexHref="#settings"
        nav={<SettingsNav sections={SETTINGS_CARDS} current="nodes" />}
      >
        <Stack gap={24}>
          <ServiceMap nodes={SERVICE_NODES} onToggleNode={noop} />
          <BackupJobList rows={BACKUP_ROWS} onToggle={noop} />
        </Stack>
      </SettingsSectionPage>
    </Stack>
  );
}

/** At a phone's width: a container the matcher finds nothing for, several nodes, no jobs yet. */
function SettingsServicesPhoneState() {
  const open = SERVICE_NODES[0];
  const nodes = [
    {
      ...open,
      count: 1,
      services: [
        mappedRow('gateway-npm', 'NPM', { kind: 'none' }, {
          editing: true,
          editor: {
            name: '',
            namePlaceholder: 'Gateway Npm',
            icon: '',
            monitor: '__auto__',
            monitorItems: [{ value: '__auto__', label: 'Auto-match' }, ...MONITOR_ITEMS.slice(1, 3)],
            hint: 'This container runs on several nodes: the monitor is set for vm-103 only, and so are the display name and icon.',
            suggestion: { monitor: null, why: null },
            candidates: [{ name: 'Loki Push', kind: 'word' }],
          },
        }),
      ],
    },
  ];
  return (
    <Stack width={390} gap={24}>
      <ServiceMap nodes={nodes} onToggleNode={noop} />
      <BackupJobList rows={[]} />
    </Stack>
  );
}

const SOURCES_DESCRIPTION =
  'Each is set in JagHelm’s .env, not here: change one there, then restart JagHelm.';

/** Settings → Sources at 880px, every source answering, in its section's page. */
function SettingsSourcesState() {
  const sources = SETTINGS_CARDS.find((s) => s.id === 'sources');
  return (
    <Stack width={880}>
      <SettingsSectionPage
        title={sources.label}
        description={sources.description}
        indexHref="#settings"
        nav={<SettingsNav sections={SETTINGS_CARDS} current="sources" />}
      >
        <SourceList
          title="Data sources"
          description={SOURCES_DESCRIPTION}
          rows={sourcesOf(SOURCES_OK)}
        />
      </SettingsSectionPage>
    </Stack>
  );
}

/** At a phone's width, push off: no phone, and a line the server refused. */
function SettingsNotificationsOffState() {
  return (
    <Stack width={390} gap={24}>
      <ThresholdTable
        description={THRESHOLDS_DESCRIPTION}
        rows={thresholdRows({
          temp: { warn: '90', error: 'The warning line (90 °C) must be under the critical line (85 °C)' },
        })}
        dirty
        onChange={noop}
        onReset={noop}
        onSave={noop}
        onDiscard={noop}
      />
      <PushDevices enabled={false} devices={[]} now={GALLERY_NOW} onTest={noop} onRemove={noop} />
    </Stack>
  );
}

/**
 * At a phone's width: services.yaml unusable, Prometheus failed, Gitea not set
 * up, a job failed and one overdue.
 */
function SettingsSourcesFailedState() {
  return (
    <Stack width={390}>
      <SourceList
        title="Data sources"
        description={SOURCES_DESCRIPTION}
        rows={sourcesOf(SOURCES_FAILED)}
      />
    </Stack>
  );
}

export const RENDERS = Object.freeze({
  button: ButtonState,
  'button-disabled': ButtonDisabledState,
  'button-focus': ButtonFocusState,
  'icon-button': IconButtonState,
  input: InputState,
  'input-focus': InputFocusState,
  select: SelectState,
  'select-open': SelectOpenState,
  switch: SwitchState,
  checkbox: CheckboxState,
  field: FieldState,
  'segmented-control': SegmentedControlState,
  tabs: () => <ServiceTabs />,
  'tab-focus': () => <ServiceTabs focus />,

  panel: PanelState,
  'panel-flush': PanelFlushState,
  'panel-untitled': PanelUntitledState,
  'dialog-sm': () => <DialogState size="sm" />,
  'dialog-md': () => <DialogState size="md" />,
  'dialog-lg': () => <DialogState size="lg" />,
  drawer: DrawerState,
  'confirm-destructive': ConfirmDestructiveState,
  confirm: ConfirmState,
  popover: PopoverState,
  'popover-hover': PopoverHoverState,
  'tooltip-name': TooltipNameState,
  'tooltip-description': TooltipDescriptionState,
  toasts: () => <Toasts toasts={NOTES} />,
  'toasts-urgent': () => <Toasts toasts={URGENT} />,
  banner: () => <BannerState />,
  'banner-plain': () => <BannerState plain />,
  'empty-state': EmptyStateState,
  skeleton: SkeletonState,

  'status-lamp': StatusLampState,
  'status-word': StatusWordState,
  'status-badge': StatusBadgeState,
  'issue-row': () => <IssueRowState />,
  'issue-row-narrow': () => <IssueRowState width={390} />,
  'subsystem-strip': SubsystemStripState,
  'subsystem-strip-narrow': SubsystemStripNarrowState,
  'subsystem-strip-counts': SubsystemStripCountsState,
  'subsystem-strip-selectable': SubsystemStripSelectableState,
  'attention-panel': AttentionPanelState,
  'attention-panel-filtered': AttentionPanelFilteredState,
  'attention-panel-filtered-empty': AttentionPanelFilteredEmptyState,
  'attention-panel-quiet': AttentionPanelQuietState,
  'attention-panel-quiet-filtered': AttentionPanelQuietFilteredState,
  'attention-panel-maintenance': AttentionPanelMaintenanceState,
  'attention-panel-first-run': AttentionPanelFirstRunState,
  'attention-panel-narrow': AttentionPanelNarrowState,
  'subsystem-strip-no-signal': SubsystemStripNoSignalState,
  'attention-panel-no-signal': AttentionPanelNoSignalState,
  'attention-panel-phone': AttentionPanelPhoneState,
  'attention-panel-phone-quiet': AttentionPanelPhoneQuietState,
  'attention-panel-phone-no-signal': AttentionPanelPhoneNoSignalState,

  'metric-meter': MetricMeterState,
  sparkline: SparklineState,
  'sparkline-tooltip': SparklineTooltipState,
  chart: ChartState,
  'monitoring-section': MonitoringSectionState,
  'stat-tile': StatTileState,
  'monitoring-power-draw': MonitoringPowerDrawState,
  'monitoring-cpu': MonitoringCpuState,
  'monitoring-cpu-drill': MonitoringCpuDrillState,
  'monitoring-cpu-drill-parts': MonitoringCpuDrillPartsState,
  'monitoring-monthly-cost': MonitoringMonthlyCostState,
  'monitoring-drives': MonitoringDrivesState,
  'monitoring-memory': MonitoringMemoryState,
  'monitoring-phone': MonitoringPhoneState,
  'monitoring-phone-states': MonitoringPhoneStatesState,
  'monitoring-phone-resources': MonitoringPhoneResourcesState,
  'monitoring-network': MonitoringNetworkState,
  'monitoring-disk-runway': MonitoringDiskRunwayState,
  'monitoring-memory-growers': MonitoringMemoryGrowersState,
  'ranked-bars': RankedBarsState,
  'ranked-bars-keyboard': RankedBarsKeyboardState,
  'daily-bars': DailyBarsState,
  'daily-bars-tooltip': DailyBarsTooltipState,
  'chart-series': ChartSeriesState,
  'chart-thresholds': ChartThresholdsState,
  'chart-crosshair': ChartCrosshairState,
  'event-strip': EventStripState,
  'event-strip-crosshair': EventStripCrosshairState,
  'monitoring-restarts': MonitoringRestartsState,
  'area-chart': AreaChartState,
  'area-chart-crosshair': AreaChartCrosshairState,
  'small-multiples': SmallMultiplesState,
  'small-multiples-phone': SmallMultiplesPhoneState,
  'uptime-bar': UptimeBarState,
  'uptime-bar-tooltip': UptimeBarTooltipState,
  'entity-row': () => <EntityRowState />,
  'entity-row-narrow': () => <EntityRowState width={390} />,
  'fact-list': FactListState,
  'fact-list-long': FactListLongState,
  'entity-detail-node': EntityDetailNodeState,
  'entity-detail-service': EntityDetailServiceState,
  'entity-detail-job': EntityDetailJobState,
  'entity-detail-history': EntityDetailHistoryState,
  'detail-drives': DetailDrivesState,
  'detail-drives-cadence': DetailDrivesCadenceState,
  'detail-drives-trouble': DetailDrivesTroubleState,
  'detail-drives-no-signal': DetailDrivesNoSignalState,
  'entity-detail-drives': EntityDetailDrivesState,
  table: TableState,
  'table-empty': TableEmptyState,
  'table-scroll': TableScrollState,
  'chart-colours': ChartColoursState,

  infrastructure: () => <InfrastructureState nodes={NODES_HEALTHY} count="3 nodes" />,
  'infrastructure-incident': () => (
    <InfrastructureState
      nodes={NODES_INCIDENT}
      count="4 nodes · 1 critical, 1 warning, 1 no signal"
    />
  ),
  'infrastructure-table': () => (
    <InfrastructureState
      nodes={NODES_INCIDENT}
      count="4 nodes · 1 critical, 1 warning, 1 no signal"
      view="table"
    />
  ),
  'infrastructure-narrow': () => (
    <InfrastructureState
      nodes={NODES_INCIDENT.slice(0, 2)}
      count="2 nodes · 1 critical, 1 warning"
      width={328}
    />
  ),
  'infrastructure-no-signal': () => (
    <InfrastructureState
      nodes={NODES_NO_SIGNAL}
      count="4 nodes · No signal · last known 3 min ago"
    />
  ),
  services: () => (
    <ServicesState groups={SERVICES_HEALTHY} count="7 monitored · all up" groupless />
  ),
  'services-incident': () => (
    <ServicesState
      groups={SERVICES_INCIDENT}
      count="7 monitored · 1 down · 1 pending · 1 no signal · 1 in maintenance"
    />
  ),
  'services-grouped': () => (
    <ServicesState groups={SERVICES_GROUPED} count="4 monitored · 1 down" grouping="group" />
  ),
  'services-no-signal': () => (
    <ServicesState
      groups={SERVICES_NO_SIGNAL}
      count="7 monitored · No signal · last known 3 min ago"
    />
  ),
  'services-stacks': () => (
    <ServicesState groups={SERVICES_STACKS} count="7 monitored · 2 degraded" />
  ),
  'services-stacks-narrow': () => (
    <ServicesState
      groups={SERVICES_STACKS.map((g) => ({ ...g, rows: g.rows.slice(0, 3) }))}
      count="7 monitored · 2 degraded"
      width={328}
    />
  ),
  'stack-panel': () => <StackPanelState members={STACK_DOWN} status={PANEL_DEGRADED} />,
  'stack-panel-healthy': () => <StackPanelState members={STACK_MEMBERS} status={PANEL_HEALTHY} />,
  'stack-panel-stopped': () => <StackPanelState members={STACK_STOPPED} status={PANEL_STOPPED} />,
  'stack-panel-phone': () => (
    <StackPanelState members={STACK_DOWN} status={PANEL_DEGRADED} width={390} />
  ),
  'settings-services-stack': () => <SettingsStackState />,
  'services-narrow': () => (
    <ServicesState
      groups={SERVICES_INCIDENT.slice(0, 1)}
      count="5 monitored · 1 down · 1 pending · 1 no signal"
      width={328}
    />
  ),
  'list-filters': ListFiltersState,
  'services-page': () => (
    <ServicesPageState
      groups={SERVICES_PROBLEMS}
      count="3 of 7 monitored · 1 down · 1 pending · 1 no signal"
      filters={<Filters state="problems" second={nodeFilter()} clear />}
    />
  ),
  'services-page-table': () => (
    <ServicesPageState
      groups={SERVICES_PAGE}
      count="7 monitored · 1 down · 1 pending · 1 no signal · 1 in maintenance"
      view="table"
      filters={<Filters second={nodeFilter()} />}
    />
  ),
  'services-page-empty': () => (
    <ServicesPageState
      groups={[]}
      count="0 of 7 monitored"
      filters={<Filters search="grafana" state="problems" second={nodeFilter()} clear />}
      empty={
        <Panel>
          <EmptyState
            title="No services match these filters"
            description="None of the 7 services fits them all."
            action={
              <Button variant="secondary" size="sm">
                Clear filters
              </Button>
            }
          />
        </Panel>
      }
    />
  ),
  'infrastructure-page': InfrastructurePageState,
  jobs: () => <JobsState groups={JOBS_HEALTHY} count="7 scheduled · all OK" />,
  'jobs-incident': () => (
    <JobsState groups={JOBS_INCIDENT} count="6 scheduled · 2 failed · 1 overdue · 1 no signal" />
  ),
  'jobs-narrow': () => (
    <JobsState
      groups={JOBS_INCIDENT}
      count="6 scheduled · 2 failed · 1 overdue · 1 no signal"
      width={328}
    />
  ),
  'overview-tablet': () => <OverviewColumnState width={476} />,
  'overview-tablet-wide': () => <OverviewColumnState width={680} />,
  'layout-editor': () => <LayoutEditorState />,
  'layout-editor-narrow': () => <LayoutEditorState width={360} />,

  'app-header': AppHeaderState,
  'app-header-first-run': AppHeaderFirstRunState,
  'app-header-edit-layout': AppHeaderEditLayoutState,
  'app-header-no-signal': AppHeaderNoSignalState,
  'side-nav': () => <SideNavState />,
  'side-nav-collapsed': () => <SideNavState collapsed open="alerts" />,
  'side-nav-unload': () => <SideNavState open="arcane" />,
  'bottom-tabs': BottomTabsState,
  'app-bar': AppBarState,
  'phone-header': PhoneHeaderState,

  'phone-overview': () => <PhoneScreenState Screen={PhoneOverview} data={phoneBoard('incident')} />,
  'phone-overview-healthy': () => (
    <PhoneScreenState Screen={PhoneOverview} data={phoneBoard('healthy')} />
  ),
  'phone-overview-no-signal': () => (
    <PhoneScreenState Screen={PhoneOverview} data={phoneBoardNoSignal()} />
  ),
  'phone-service-detail': () => (
    <PhoneScreenState
      Screen={PhoneServiceDetail}
      data={withBeats(phoneBoard('incident'), 'vm-103:immich')}
      params={{ uid: 'vm-103:immich' }}
      sheet
    />
  ),
  // #586: the UPS's sheet as the web draws it (PhoneDetail): its facts are the model's.
  'phone-ups-detail': () => (
    <PhoneScreenState
      Screen={PhoneUpsSheet}
      data={phoneBoard('incident')}
      params={{ id: 'power/ups' }}
      sheet
    />
  ),
  'phone-node-history': () => (
    <PhoneScreenState
      Screen={PhoneNodeDetail}
      data={phoneBoard('healthy')}
      params={{ nodeKey: 'jagnas' }}
      charts={PHONE_NODE_HISTORY}
      sheet
    />
  ),
  'phone-node-drives': () => (
    <PhoneScreenState
      Screen={PhoneNodeDetail}
      data={phoneNodeWithDrives(NAS_TROUBLE)}
      params={{ nodeKey: 'jagnas' }}
      sheet
    />
  ),
  'phone-container-history': () => (
    <PhoneScreenState
      Screen={PhoneServiceDetail}
      data={phoneBoard('healthy')}
      params={{ uid: 'vm-103:nextcloud' }}
      charts={PHONE_CONTAINER_HISTORY}
      sheet
    />
  ),

  login: () => <LoginState />,
  'login-busy': () => <LoginState busy />,
  'login-error': () => <LoginErrorState />,
  'login-no-answer': () => <LoginErrorState form />,

  'utilities-rail': UtilitiesRailState,
  'launch-page': LaunchPageState,
  'utilities-empty': UtilitiesEmptyState,
  'utilities-failing': UtilitiesFailingState,
  'utilities-weather': UtilitiesWeatherState,

  'settings-index': () => <SettingsIndexState />,
  'settings-index-search': () => <SettingsIndexState query="link" sections={SETTINGS_FOUND} />,
  'settings-section': SettingsSectionState,
  'settings-appearance': SettingsAppearanceState,
  'themes-panel': ThemesPanelState,
  'themes-import-rejected': () => <ThemesImportState text={JSON.stringify(THEME_DIM, null, 2)} />,
  'themes-import-ready': () => (
    <ThemesImportState text={JSON.stringify(THEME_MIDNIGHT, null, 2)} />
  ),
  'themed-screen-midnight': () => <ThemedScreenState theme={THEME_MIDNIGHT} />,
  'themed-screen-paper': () => <ThemedScreenState theme={THEME_PAPER} />,
  'settings-appearance-notice': SettingsAppearanceNoticeState,
  ...Object.fromEntries(
    TYPEFACES.map((face) => [`typeface-${face.id}`, () => <TypefaceState face={face} />])
  ),
  'settings-apps': SettingsAppsState,
  'settings-energy-empty': () => <EnergyState />,
  'settings-energy': () => <EnergyState config={ENERGY_SAVED} />,
  'settings-energy-error': () => <EnergyState initial={ENERGY_BAD} width={390} page={false} />,
  'settings-apps-blocked': SettingsAppsBlockedState,
  'settings-notifications': SettingsNotificationsState,
  'settings-notifications-off': SettingsNotificationsOffState,
  'drive-health-setting': DriveHealthSettingState,
  'web-push-device': WebPushDeviceState,
  'web-push-problems': WebPushProblemsState,
  'access-expired': AccessExpiredState,
  'alerts-stopped': AlertsStoppedState,
  'settings-integrations': SettingsIntegrationsState,
  'settings-integrations-empty': SettingsIntegrationsEmptyState,
  'settings-integrations-form': SettingsIntegrationsFormState,
  'settings-services': SettingsServicesState,
  'settings-services-phone': SettingsServicesPhoneState,
  'settings-sources': SettingsSourcesState,
  'settings-sources-failed': SettingsSourcesFailedState,

  'command-palette': () => <CommandPaletteState />,
  'command-palette-search': () => <CommandPaletteState query="gra" groups={PALETTE_SEARCH} />,

  'alert-history': () => <AlertHistoryState width={912} />,
  'alert-history-narrow': () => <AlertHistoryState width={390} days={LONG_NAME_DAYS} />,
  'alert-history-states': AlertHistoryStatesState,
  'alert-filters': AlertFiltersState,
  'alerts-page': () => <AlertsPageState />,
  'alerts-page-filtered': () => (
    <AlertsPageState filters={{ severity: 'warning', kind: 'nodes', q: '' }} />
  ),
  'phone-alerts': () => <PhoneScreenState Screen={PhoneAlertsScreen} data={ALERT_BOARD} />,
});
