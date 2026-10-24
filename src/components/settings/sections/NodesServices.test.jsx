/*
 * Settings → Nodes & Services (#319): the services with their monitor
 * mapping, and the cron jobs marked as backups. How a monitor is chosen is
 * ServicesTab.test.jsx's; these drive the section against a stub server.
 */
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NodesServices from './NodesServices.jsx';
import { ConfigProvider } from '../../../context/ConfigContext.jsx';
import { OverlayProvider } from '../../../context/OverlayContext.jsx';
import { forgetAnswers } from '../../../hooks/useData.js';

const SERVICES_YAML = {
  nodes: { vm103: { display_name: 'vm-103', visible: true } },
  services: {},
};
const LIVE = {
  nodes: {
    vm103: {
      display_name: 'vm-103',
      services: [
        { container: 'loki', display_name: 'Loki', uid: 'vm103:loki', status: 'up', monitored: false },
        { container: 'gitea', display_name: 'Gitea', uid: 'vm103:gitea', status: 'up', monitored: true },
      ],
    },
  },
};
const MAPPING = {
  services: {
    'vm103:loki': { attached: null, suggested: null, why: null, candidates: [] },
    'vm103:gitea': { attached: 'Gitea', suggested: 'Gitea', why: 'exact', candidates: [{ name: 'Gitea', kind: 'exact' }] },
  },
};
const CRON = [
  { node: 'pve', jobs: [{ job: 'proxmox-backup', runs: [] }] },
  { node: 'nas', jobs: [{ job: 'b2-sync', runs: [] }, { job: 'cleanup', runs: [] }] },
];

function serve({ cron = CRON } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const u = String(url);
      if (u.endsWith('/api/services/config')) return Response.json(SERVICES_YAML, { headers: { ETag: '"v1"' } });
      if (u.endsWith('/api/services/monitors')) return Response.json(['Gitea']);
      if (u.endsWith('/api/services/monitor-mapping')) return Response.json(MAPPING);
      if (u.endsWith('/api/services')) return Response.json(LIVE);
      if (u.endsWith('/cron/status')) {
        return cron === null ? Response.json({}, { status: 500 }) : Response.json(cron);
      }
      return Response.json({}, { status: 404 });
    })
  );
}

function Harness({ initial = {} }) {
  const [config, setConfig] = useState(initial);
  window.__display = config;
  return (
    <OverlayProvider>
      <ConfigProvider config={config} setConfig={setConfig}>
        <NodesServices />
      </ConfigProvider>
    </OverlayProvider>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  forgetAnswers();
});

describe('services', () => {
  it('a running container with no Kuma monitor says "no monitor" (the Loki case)', async () => {
    serve();
    render(<Harness />);
    await userEvent.click(await screen.findByRole('button', { name: /vm-103/ }));
    const loki = document.querySelector('[data-service="vm103:loki"] [data-slot="monitor-tag"]');
    expect(loki).toHaveTextContent('no monitor');
    const gitea = document.querySelector('[data-service="vm103:gitea"] [data-slot="monitor-tag"]');
    expect(gitea).toHaveTextContent('monitored');
    expect(gitea).toHaveTextContent('Gitea');
  });
});

describe('backup jobs', () => {
  const panel = () => screen.findByRole('region', { name: 'Backup jobs' });

  it('lists the jobs that reported, none marked until chosen', async () => {
    serve();
    render(<Harness />);
    const jobs = await panel();
    expect(await within(jobs).findByText('proxmox-backup')).toBeInTheDocument();
    for (const sw of within(jobs).getAllByRole('switch')) expect(sw).not.toBeChecked();
  });

  it('marking a job writes it into the display config’s backupJobs', async () => {
    serve();
    render(<Harness />);
    const jobs = await panel();
    await userEvent.click(await within(jobs).findByRole('switch', { name: 'proxmox-backup on pve is a backup' }));
    expect(window.__display.backupJobs).toEqual(['pve:proxmox-backup']);
    await userEvent.click(within(jobs).getByRole('switch', { name: 'b2-sync on nas is a backup' }));
    expect(window.__display.backupJobs).toEqual(['pve:proxmox-backup', 'nas:b2-sync']);
  });

  it('shows the jobs the existing backupJobs key already names, and unmarking removes just that one', async () => {
    serve();
    render(<Harness initial={{ backupJobs: ['pve:proxmox-backup', 'nas:b2-sync'] }} />);
    const jobs = await panel();
    const sw = await within(jobs).findByRole('switch', { name: 'proxmox-backup on pve is a backup' });
    await waitFor(() => expect(sw).toBeChecked());
    expect(within(jobs).getByRole('switch', { name: 'cleanup on nas is a backup' })).not.toBeChecked();
    await userEvent.click(sw);
    expect(window.__display.backupJobs).toEqual(['nas:b2-sync']);
  });

  it('a marked job nothing reports is still listed, as not reporting', async () => {
    serve({ cron: [] });
    render(<Harness initial={{ backupJobs: ['old:gone'] }} />);
    const jobs = await panel();
    expect(await within(jobs).findByText(/not reporting/)).toBeInTheDocument();
    expect(within(jobs).getByRole('switch', { name: 'gone on old is a backup' })).toBeChecked();
  });

  it('says the jobs couldn’t be read when the read fails', async () => {
    serve({ cron: null });
    render(<Harness />);
    expect(await within(await panel()).findByText(/couldn’t be read/)).toBeInTheDocument();
  });
});
