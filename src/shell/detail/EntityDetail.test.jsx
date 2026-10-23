import { describe, it, expect } from 'vitest';
import { render, within } from '@testing-library/react';
import { EntityDetail } from './EntityDetail.jsx';
import { entityDetail } from './entityDetail.js';
import { entityExtras, memoryText, rateText, sourcesFor } from './entityExtras.js';
import { demoStatusCycle } from '../../../server/demoFixtures.js';
import { createStatusTracker, readStatusInputs } from '../../../server/status/index.js';

// The detail drawer's body per kind (#310, spec §8), from fixtures the live
// status model judges (the demo's healthy board, with a Proxmox integration,
// an integration on Jellyfin, a container no monitor watches, and the UPS on
// battery or on mains), as the drawer reads them: the status, and the reads
// it makes while open (/api/services, /api/integrations, /api/ups).

const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

const PROXMOX = Object.freeze({
  _preset: 'proxmox',
  _target: 'apps:qemu-guest',
  Running: '2/3',
  _vms: [
    {
      name: 'docker-brain',
      vmid: 103,
      status: 'running',
      maxcpu: 8,
      memUsedGB: '21.4',
      memTotalGB: '32.0',
    },
    {
      name: 'staging',
      vmid: 101,
      status: 'running',
      maxcpu: 4,
      memUsedGB: '3.1',
      memTotalGB: '8.0',
    },
    { name: 'win11', vmid: 110, status: 'stopped', maxcpu: 4, memUsedGB: null, memTotalGB: '16.0' },
  ],
  _storagePools: [
    {
      name: 'local',
      type: 'dir',
      usedGB: '12.0',
      totalGB: '94.0',
      percent: 12.8,
      status: 'available',
    },
    {
      name: 'local-lvm',
      type: 'lvmthin',
      usedGB: '851.2',
      totalGB: '900.0',
      percent: 94.6,
      status: 'available',
    },
  ],
  _lastBackup: {
    time: NOW - 3 * HOUR,
    ago: '3h ago',
    ok: true,
    status: 'OK',
    vmCount: 2,
    vmids: ['101', '103'],
  },
});
const JELLYFIN = Object.freeze({
  _preset: 'jellyfin',
  _target: 'apps:jellyfin',
  Movies: '1,204',
  Shows: '87',
});
const ON_BATTERY = Object.freeze({
  status: 2,
  charge: 64,
  runtime: 1290,
  load: 31,
  ok: true,
  configured: true,
  model: 'Example UPS 1500VA',
});

const CONFIG = {
  linkTarget: '_blank',
  tabs: [
    { id: 'grafana', label: 'Grafana', type: 'iframe', url: 'https://grafana.example.com' },
    { id: 'kuma', label: 'Uptime Kuma', type: 'iframe', url: 'https://status.example.com' },
  ],
  links: {
    media: [{ name: 'Jellyfin', url: 'https://jellyfin.example.com', icon: 'jellyfin' }],
    admin: [{ name: 'Proxmox apps', url: 'https://pve.example.com:8006', icon: 'proxmox' }],
  },
};

/**
 * The demo's healthy board judged by the live model, with `integrations`, the
 * UPS reading `ups` and `change` made to its /api/services; and the drawer's
 * reads of the same payloads.
 */
function board({ integrations = {}, ups = null, change = null } = {}) {
  const cycle = demoStatusCycle({ scenario: 'healthy', now: NOW });
  const services = structuredClone(cycle.caches.getCached('services'));
  change?.(services);
  const cached = { services, integrations, ...(ups && { ups }) };
  const caches = {
    ...cycle.caches,
    getCached: (key) => (Object.hasOwn(cached, key) ? cached[key] : cycle.caches.getCached(key)),
  };
  const status = createStatusTracker().update({
    inputs: readStatusInputs(caches, cycle.extra),
    thresholds: cycle.thresholds,
    now: NOW,
  });
  const read = {
    services: { body: services, error: null },
    integrations: { body: integrations, error: null },
    ups: { body: caches.getCached('ups'), error: null },
  };
  return { status, read };
}

function drawn(id, { status, read }, extra = {}) {
  const view = entityDetail({ status, reach: 'ok', id, at: NOW, read, config: CONFIG, ...extra });
  const { container, unmount } = render(<EntityDetail view={view} />);
  return { view, root: within(container), container, unmount };
}

/** A FactList's value for `label`, in the section named `section` or anywhere. */
function factIn(root, label, section) {
  const scope = section ? within(root.getByRole('region', { name: section })) : root;
  const terms = scope.getAllByText(label, { selector: 'dt' });
  return terms[0].nextElementSibling.textContent;
}

describe('a node (#310)', () => {
  it('its meters, uptime, memory and disk in units, its hosted services, and its links', () => {
    const { root, container, view } = drawn('nodes/edge', board());
    expect(view.where).toBe('edge · Raspberry Pi 4');
    expect(container.querySelector('[data-slot="detail-status"]')).toHaveTextContent(
      '3 / 3 services up'
    );
    const meters = [...container.querySelectorAll('[data-slot="metric-meter"]')];
    expect(meters.map((m) => m.getAttribute('data-reading'))).toEqual([
      'cpu',
      'mem',
      'disk',
      'temp',
    ]);
    expect(factIn(root, 'Uptime')).toBe('41d 6h');
    expect(factIn(root, 'Memory')).toBe('1.4 / 7.6 GB');
    expect(factIn(root, 'Disk')).toBe('18.2 / 58.3 GB');
    // No Proxmox integration on it: no machines, pools or backup.
    expect(root.queryByRole('region', { name: 'Virtual machines' })).toBeNull();
    expect(root.getByRole('link', { name: 'Open in Grafana' })).toHaveAttribute(
      'href',
      '/apps/grafana'
    );
    expect(root.getByRole('link', { name: 'Node settings' })).toHaveAttribute(
      'href',
      '/settings/nodes'
    );
  });

  it('a Proxmox node: its machines, its pools on the disk rule, its last backup, and Open Proxmox', () => {
    const { root } = drawn('nodes/apps', board({ integrations: { proxmox: PROXMOX } }));
    const vms = root.getByRole('region', { name: 'Virtual machines' });
    expect(vms).toHaveTextContent('2 / 3 running');
    const rows = within(vms).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      'docker-brain8 vCPU · 21.4 / 32.0 GB · ID 103Running',
      'staging4 vCPU · 3.1 / 8.0 GB · ID 101Running',
      'win114 vCPU · ID 110Stopped',
    ]);

    const pools = root.getByRole('region', { name: 'Storage pools' });
    const lvm = within(pools).getByRole('meter', { name: 'local-lvm' });
    // 94.6 % is over the disk rule's warning line (90 %), under its critical one (95 %).
    expect(lvm).toHaveAttribute('data-state', 'warn');
    expect(lvm).toHaveAttribute('aria-valuetext', '94%, warning above 90%');
    expect(within(pools).getByRole('meter', { name: 'local' })).toHaveAttribute('data-state', 'ok');
    expect(pools).toHaveTextContent('851.2 / 900.0 GB · lvmthin');

    expect(factIn(root, 'When', 'Last backup')).toBe('3 h ago');
    expect(factIn(root, 'Result', 'Last backup')).toBe('OK');
    expect(factIn(root, 'Backed up', 'Last backup')).toBe('2 VMs');

    expect(root.getByRole('link', { name: /^Open Proxmox/ })).toHaveAttribute(
      'href',
      'https://pve.example.com:8006'
    );
    expect(root.getByRole('link', { name: 'Grafana' })).toHaveAttribute('href', '/apps/grafana');
  });

  it('a backup still running says so, never "Failed"', () => {
    for (const status of [undefined, '', 'running']) {
      const running = {
        ...PROXMOX,
        _lastBackup: { time: NOW - 5 * 60_000, ok: false, status, vmCount: 1 },
      };
      const { root, unmount } = drawn('nodes/apps', board({ integrations: { proxmox: running } }));
      expect(factIn(root, 'Result', 'Last backup')).toBe('Running');
      expect(factIn(root, 'Backed up', 'Last backup')).toBe('1 VM so far');
      expect(root.queryByText('Failed')).toBeNull();
      unmount();
    }
  });

  it('a failed Proxmox read says so, and a failed backup gives Proxmox’s own words', () => {
    const failed = {
      ...PROXMOX,
      _lastBackup: { ...PROXMOX._lastBackup, ok: false, status: 'job errors' },
    };
    let { root } = drawn('nodes/apps', board({ integrations: { proxmox: failed } }));
    expect(factIn(root, 'Result', 'Last backup')).toBe('job errors');
    root = drawn(
      'nodes/apps',
      board({
        integrations: { proxmox: { _preset: 'proxmox', _target: 'apps:x', _error: 'HTTP 401' } },
      })
    ).root;
    expect(root.getByRole('region', { name: 'Proxmox' })).toHaveTextContent(
      'Its last read failed: HTTP 401'
    );
  });

  it('with the status stale, every meter is no signal', () => {
    const { container } = drawn('nodes/apps', board({ integrations: { proxmox: PROXMOX } }), {
      freshness: { stale: true, cause: "Can't reach JagHelm" },
    });
    const states = [...container.querySelectorAll('[data-slot="metric-meter"]')].map((m) =>
      m.getAttribute('data-state')
    );
    expect(states.length).toBe(5);
    expect(new Set(states)).toEqual(new Set(['unknown']));
  });
});

describe('a service and a container (#310)', () => {
  it('a service with an integration: its numbers, its container, the integration’s stats, Open, Kuma and Grafana', () => {
    const { root } = drawn(
      'services/apps:jellyfin',
      board({ integrations: { jellyfin: JELLYFIN } })
    );
    expect(factIn(root, 'Latency')).toBe('64 ms');
    expect(factIn(root, 'Uptime · 24 h')).toBe('99.9 %');
    expect(factIn(root, 'Node')).toBe('App Server');

    expect(factIn(root, 'CPU', 'Container')).toBe('11.8 %');
    expect(factIn(root, 'Memory', 'Container')).toBe('1.3 GB');
    expect(factIn(root, 'RX', 'Container')).toBe('1.1 MB/s');
    expect(factIn(root, 'TX', 'Container')).toBe('6.2 MB/s');

    expect(factIn(root, 'Movies', 'From jellyfin')).toBe('1,204');
    expect(factIn(root, 'Shows', 'From jellyfin')).toBe('87');

    const open = root.getByRole('link', { name: /^Open Jellyfin/ });
    expect(open).toHaveAttribute('href', 'https://jellyfin.example.com');
    expect(open).toHaveAttribute('target', '_blank');
    expect(root.getByRole('link', { name: 'Uptime Kuma' })).toHaveAttribute('href', '/apps/kuma');
    expect(root.getByRole('link', { name: 'Grafana' })).toHaveAttribute('href', '/apps/grafana');
    expect(root.getByRole('link', { name: 'Service settings' })).toHaveAttribute(
      'href',
      '/settings/services'
    );
  });

  it('an integration whose last read failed says why', () => {
    const { root } = drawn(
      'services/apps:jellyfin',
      board({
        integrations: {
          jellyfin: { _preset: 'jellyfin', _target: 'apps:jellyfin', _error: 'HTTP 502' },
        },
      })
    );
    expect(root.getByRole('region', { name: 'From jellyfin' })).toHaveTextContent(
      'Its last read failed: HTTP 502'
    );
  });

  it('a container no monitor watches: its container’s numbers, no latency and no Kuma', () => {
    const fixture = board({
      change: (services) => {
        const card = services.nodes.apps.services.find((c) => c.uid === 'apps:nextcloud');
        card.monitored = false;
      },
    });
    const { root, view } = drawn('services/apps:nextcloud', fixture);
    expect(view.eyebrow).toBe('Container');
    expect(view.word).toBe('Running');
    expect(factIn(root, 'CPU', 'Container')).toBe('3.4 %');
    expect(factIn(root, 'Memory', 'Container')).toBe('612.5 MB');
    expect(factIn(root, 'RX', 'Container')).toBe('86.0 KB/s');
    expect(root.queryByText('Latency')).toBeNull();
    expect(root.queryByRole('link', { name: 'Uptime Kuma' })).toBeNull();
  });
});

describe('the UPS (#310)', () => {
  it('on battery: its charge, the runtime left, its load and model', () => {
    const { root, view } = drawn('power/ups', board({ ups: ON_BATTERY }));
    expect(view.word).toBe('On battery');
    expect(view.reason).toBe('On battery (64 % charge)');
    expect(factIn(root, 'Charge')).toBe('64 %');
    expect(factIn(root, 'Runtime')).toBe('22 min left');
    expect(factIn(root, 'Load')).toBe('31 %');
    expect(factIn(root, 'Model')).toBe('Example UPS 1500VA');
    expect(root.getByRole('link', { name: 'UPS settings' })).toHaveAttribute(
      'href',
      '/settings/sections'
    );
  });

  it('on mains: the runtime it has at this load', () => {
    const { root, view } = drawn('power/ups', board());
    expect(view.word).toBe('On mains');
    expect(factIn(root, 'Charge')).toBe('100 %');
    expect(factIn(root, 'Runtime')).toBe('41 min at this load');
    expect(factIn(root, 'Load')).toBe('18 %');
    expect(factIn(root, 'Model')).toBe('Example UPS 1500VA');
  });

  it('with no freshness given, it reads the status as fresh', () => {
    const { status, read } = board({ ups: ON_BATTERY });
    const entity = status.entities.find((e) => e.id === 'power/ups');
    const extras = entityExtras({ status, entity, read, at: NOW });
    expect(extras.facts.map((f) => f.value)).toEqual([
      '64 %',
      '22 min left',
      '31 %',
      'Example UPS 1500VA',
    ]);
    expect(entityExtras({ status, entity, read, freshness: null }).facts).toHaveLength(4);
  });

  it('with the status stale, its readings are greyed as last known, and no runtime is drawn', () => {
    const { root, container } = drawn('power/ups', board({ ups: ON_BATTERY }), {
      freshness: { stale: true, cause: "Can't reach JagHelm", lastKnown: 'last known 3 min ago' },
    });
    const facts = container.querySelector('[data-slot="fact-list"]');
    expect(facts).toHaveAttribute('data-muted');
    expect(container.querySelector('[data-slot="detail-facts"]')).toHaveTextContent(
      'Last known 3 min ago'
    );
    expect(factIn(root, 'Load')).toBe('31 %');
    expect(root.queryByText('Runtime')).toBeNull();
    expect(container.querySelector('[data-slot="detail-status"]')).toHaveAttribute(
      'data-state',
      'unknown'
    );
  });

  it('a failed read keeps what it had and says it isn’t updating', () => {
    const fixture = board();
    fixture.read.ups.error = 'HTTP 502';
    const { root, container } = drawn('power/ups', fixture);
    expect(factIn(root, 'Load')).toBe('18 %');
    expect(container.querySelector('[data-slot="detail-unread"]')).toHaveTextContent(
      "JagHelm couldn't read the UPS's readings (HTTP 502)"
    );
  });
});

describe('a job and a backup (#310): what the model has; their runs are #578’s', () => {
  it('a job: its word and reason, where it runs under its name, and nothing else yet', () => {
    const { view, container } = drawn('jobs/apps:db-dump', board());
    expect(view.eyebrow).toBe('Job');
    expect(view.where).toBe('apps');
    expect(container.querySelector('[data-slot="detail-status"]')).toHaveTextContent('OK');
    expect(container.querySelector('[data-slot="fact-list"]')).toBeNull();
    expect(container.querySelector('[data-slot="detail-links"]')).toBeNull();
  });

  it('a backup: its word and reason, where it runs under its name', () => {
    const { view, container } = drawn('backups/storage:nightly-backup', board());
    expect(view.eyebrow).toBe('Backup');
    expect(view.where).toBe('storage');
    expect(container.querySelector('[data-slot="detail-status"]')).toHaveTextContent(
      'Last backup succeeded'
    );
  });

  it('a slot for the Jobs card’s runs, drawn where it goes when given', () => {
    const fixture = board();
    const view = entityDetail({
      status: fixture.status,
      reach: 'ok',
      id: 'jobs/apps:db-dump',
      at: NOW,
      read: fixture.read,
    });
    const { container } = render(
      <EntityDetail view={view} slots={{ runs: (v) => <p data-testid="runs">{v.title} runs</p> }} />
    );
    expect(within(container).getByTestId('runs')).toHaveTextContent('db-dump runs');
  });
});

describe('what the drawer reads while open (#310, the request budget)', () => {
  it('per kind: 2 for a node or a service (1 with no integration), 1 for the UPS, none for a job', () => {
    const plain = board().status;
    const withOne = board({ integrations: { jellyfin: JELLYFIN } }).status;
    const of = (status, id) =>
      sourcesFor(
        status.entities.find((e) => e.id === id),
        status
      );
    expect(of(withOne, 'nodes/apps')).toEqual(['services', 'integrations']);
    expect(of(withOne, 'services/apps:jellyfin')).toEqual(['services', 'integrations']);
    expect(of(plain, 'nodes/apps')).toEqual(['services']);
    expect(of(plain, 'power/ups')).toEqual(['ups']);
    expect(of(withOne, 'integrations/jellyfin')).toEqual(['integrations']);
    expect(of(plain, 'jobs/apps:db-dump')).toEqual([]);
    expect(of(plain, 'backups/storage:nightly-backup')).toEqual([]);
    expect(sourcesFor(null, plain)).toEqual([]);
  });

  it('formats a container’s memory and rates', () => {
    expect(memoryText(612.5)).toBe('612.5 MB');
    expect(memoryText(1284)).toBe('1.3 GB');
    expect(rateText(640)).toBe('640 B/s');
    expect(rateText(12_700)).toBe('12.4 KB/s');
    expect(rateText(1_180_000)).toBe('1.1 MB/s');
    expect(rateText(null)).toBeNull();
  });
});
