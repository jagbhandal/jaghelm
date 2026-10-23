/*
 * Settings → Sources (#318, spec §7): each source JagHelm reads with its live
 * health, from the status poll the board reads (useStatus), on the status
 * model's fixtures (server/testing/statusScenarios.js).
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Sources from './Sources.jsx';
import { CONFIG, CRON, SOURCES } from './sourcesView.js';
import { SETTINGS_SECTIONS } from '../sections.js';
import { paletteIndex, paletteSearch } from '../../../shell/paletteIndex.js';
import {
  CONFIG_BROKEN,
  PROMETHEUS_ERROR,
  scenarioStatus,
} from '../../../../server/testing/statusScenarios.js';

const NOW = 1_782_345_600_000;
const status = (name) => scenarioStatus(name, { now: NOW });

/** The poll's clock: answered just now, the status built at the scenario's now. */
const updated = {
  subscribe: () => () => {},
  get: () => Date.now(),
  builtAt: () => NOW,
  staleAfter: 72_000,
};

const draw = (props) => render(<Sources reach="ok" updated={updated} {...props} />);
const row = (id) => within(document.getElementById(id));
const lampOf = (id) => document.getElementById(id).querySelector('[data-slot="status-lamp"]');

describe('Settings → Sources', () => {
  it('a failed source shows the error the model gives, and one answering says so', () => {
    // source-down: Prometheus failed, Kuma, NUT and Gitea answering.
    draw({ status: status('source-down') });
    expect(row('prometheus').getByRole('heading', { name: 'Prometheus' })).toBeInTheDocument();
    expect(row('prometheus').getByText('Failed')).toBeInTheDocument();
    expect(row('prometheus').getByText(PROMETHEUS_ERROR)).toBeInTheDocument();
    expect(row('prometheus').getByText('· for 30 s')).toBeInTheDocument();
    expect(lampOf('prometheus')).toHaveAttribute('data-state', 'warn');
    expect(row('kuma').getByText('Answering')).toBeInTheDocument();
    expect(row('kuma').getByText('· for 1 min')).toBeInTheDocument();
    expect(lampOf('kuma')).toHaveAttribute('data-state', 'ok');
    expect(row('kuma').queryByText(PROMETHEUS_ERROR)).toBeNull();
  });

  it('a source the model doesn’t list is not set up, and names the variable to set', () => {
    // A first run: Prometheus alone.
    draw({ status: status('first-run') });
    expect(row('prometheus').getByText('Answering')).toBeInTheDocument();
    for (const id of ['kuma', 'gitea']) {
      const { variable } = SOURCES.find((s) => s.id === id).setting;
      expect(row(id).getByText('Not set up')).toBeInTheDocument();
      expect(
        row(id).getByText(`Set ${variable} in .env, then restart JagHelm.`)
      ).toBeInTheDocument();
      expect(lampOf(id)).toBeNull();
      // Not "Set in .env as": it isn't.
      expect(document.getElementById(id)).not.toHaveTextContent('Set in .env as');
    }
    expect(row('nut').getByText('Not set up')).toBeInTheDocument();
    expect(
      row('nut').getByText(
        "JagHelm reads the UPS through Prometheus: add your NUT server's metrics to Prometheus, then, with more than one UPS, set JAGHELM_UPS_NAME in .env to choose which."
      )
    ).toBeInTheDocument();
    expect(row(CRON.id).getByText('Not set up')).toBeInTheDocument();
    expect(row(CRON.id).getByText(/No job has reported yet/)).toHaveTextContent(
      'JAGHELM_CRON_SECRET'
    );
  });

  it('a configured source never shows a blank: its word, since when, and where it is set', () => {
    draw({ status: status('healthy') });
    for (const { id, name, setting } of SOURCES) {
      const { label, variable } = setting;
      expect(row(id).getByRole('heading', { name })).toBeInTheDocument();
      expect(row(id).getByText('Answering')).toBeInTheDocument();
      expect(row(id).getByText('· for 15 min')).toBeInTheDocument();
      expect(row(id).getByText(variable)).toBeInTheDocument();
      expect(document.getElementById(id)).toHaveTextContent(`${label} ${variable}`);
    }
  });

  it('a URL refused for holding a password is off, saying why in the model’s words', () => {
    const healthy = status('healthy');
    const problem =
      'KUMA_URL carries a user name and a password, so it is not used: put the API key in KUMA_API_KEY';
    draw({
      status: {
        ...healthy,
        sources: { ...healthy.sources, kuma: { state: 'failed', error: problem, since: NOW } },
        issues: [
          { id: 'sources/kuma', kind: 'source', state: 'warn', word: 'Off', reason: problem },
        ],
      },
    });
    expect(row('kuma').getByText('Off')).toBeInTheDocument();
    expect(row('kuma').getByText(problem)).toBeInTheDocument();
    expect(lampOf('kuma')).toHaveAttribute('data-state', 'warn');
  });

  it('cron reporters: how many report, the newest report’s age, and the model’s words for its subsystems, counted not listed', () => {
    // every-state: three jobs (one failed, one overdue) and an overdue backup.
    const board = status('every-state');
    draw({ status: board });
    const cron = document.getElementById(CRON.id);
    expect(cron).toHaveTextContent(/3 jobs and 1 backup report · newest .+ ago/);
    expect(row(CRON.id).getByText('Jobs: 1 overdue · 1 failed')).toBeInTheDocument();
    expect(row(CRON.id).getByText('Backups: 1 overdue')).toBeInTheDocument();
    expect(lampOf(CRON.id)).toHaveAttribute('data-state', 'warn');
    expect(row(CRON.id).queryByText('Reporting')).toBeNull();
    for (const job of board.entities.filter((e) => e.kind === 'job' || e.kind === 'backup')) {
      expect(cron).not.toHaveTextContent(job.name);
    }
    expect(cron).toHaveTextContent('Reporters send JAGHELM_CRON_SECRET, set in .env');
  });

  it('jobs and backups all well: "Reporting", green', () => {
    draw({ status: status('healthy') });
    expect(row(CRON.id).getByText('Reporting')).toBeInTheDocument();
    expect(lampOf(CRON.id)).toHaveAttribute('data-state', 'ok');
  });

  it('every job overdue, the newest report days old: not green, and the model’s word', () => {
    const at = (days) => NOW - days * 86_400_000;
    const job = (name, days) => ({
      id: `jobs/apps:${name}`,
      kind: 'job',
      subsystem: 'jobs',
      name,
      node: 'apps',
      state: 'warn',
      word: 'Overdue',
      reason: 'Overdue: no report on schedule (expected every 24 h)',
      lastRun: at(days),
      overdue: true,
    });
    const healthy = status('healthy');
    draw({
      status: {
        ...healthy,
        entities: [job('db-dump', 3), job('image-prune', 4)],
        subsystems: [
          {
            id: 'jobs',
            name: 'Jobs',
            state: 'warn',
            counts: { total: 2, ok: 0, warn: 2, crit: 0, unknown: 0, maintenance: 0 },
            detail: '0 / 2 OK',
            value: '0 / 2',
            sub: '2 overdue',
          },
        ],
      },
    });
    expect(lampOf(CRON.id)).toHaveAttribute('data-state', 'warn');
    expect(row(CRON.id).getByText('Overdue')).toBeInTheDocument();
    expect(row(CRON.id).queryByText('Reporting')).toBeNull();
    expect(row(CRON.id).getByText('2 jobs report · newest 3 d ago')).toBeInTheDocument();
    expect(row(CRON.id).getByText('Jobs: 2 overdue')).toBeInTheDocument();
  });

  it('a failed backup beside an ok job: critical, and its link shows both, the backup not hidden', () => {
    const incident = status('incident');
    const job = incident.entities.find((e) => e.kind === 'job');
    const backup = incident.entities.find((e) => e.kind === 'backup');
    expect(backup.state).toBe('crit');
    draw({
      status: {
        ...incident,
        entities: [job, backup],
        subsystems: incident.subsystems.map((x) =>
          x.id === 'jobs'
            ? {
                ...x,
                counts: { ...x.counts, total: 1, ok: 1 },
                detail: '1 / 1 OK',
                value: '1 / 1',
              }
            : x
        ),
      },
    });
    expect(lampOf(CRON.id)).toHaveAttribute('data-state', 'crit');
    expect(row(CRON.id).getByText('Failed')).toBeInTheDocument();
    expect(row(CRON.id).getByText('Backups: 1 failed')).toBeInTheDocument();
    // Not "/?subsystem=jobs", which shows the Jobs group alone.
    expect(row(CRON.id).getByRole('link', { name: 'Open Jobs and Backups' })).toHaveAttribute(
      'href',
      '/'
    );
  });

  it.each([
    ['job', 'backups', 'Open Jobs', '/?subsystem=jobs'],
    ['backup', 'jobs', 'Open Backups', '/?subsystem=backups'],
  ])('only %ss report: the link opens that group alone', (kind, other, label, href) => {
    const board = status('every-state');
    draw({
      status: {
        ...board,
        entities: board.entities.filter((e) => e.kind !== (kind === 'job' ? 'backup' : 'job')),
        subsystems: board.subsystems.filter((x) => x.id !== other),
      },
    });
    expect(row(CRON.id).getByRole('link', { name: label })).toHaveAttribute('href', href);
  });

  it('services.yaml that can’t be used: a row first, in the model’s words, linking to Nodes & Services', () => {
    draw({ status: status('config-broken') });
    const rows = [...document.querySelectorAll('[data-slot="source-row"]')];
    expect(rows[0]).toHaveAttribute('id', CONFIG.id);
    expect(row(CONFIG.id).getByRole('heading', { name: 'services.yaml' })).toBeInTheDocument();
    expect(row(CONFIG.id).getByText("Can't be read")).toBeInTheDocument();
    expect(row(CONFIG.id).getByText(CONFIG_BROKEN)).toBeInTheDocument();
    expect(lampOf(CONFIG.id)).toHaveAttribute('data-state', 'warn');
    expect(row(CONFIG.id).getByRole('link', { name: 'Open Nodes & Services' })).toHaveAttribute(
      'href',
      '/settings/nodes'
    );
  });

  it('services.yaml in use: no row for it', () => {
    draw({ status: status('healthy') });
    expect(document.getElementById(CONFIG.id)).toBeNull();
  });

  it('a stale status draws every lamp as no signal, keeps what it last said, and says how old', () => {
    draw({ status: status('source-down'), reach: 'down' });
    const lamps = [...document.querySelectorAll('[data-slot="status-lamp"]')];
    expect(lamps).toHaveLength(SOURCES.length + 1);
    for (const lamp of lamps) expect(lamp).toHaveAttribute('data-state', 'unknown');
    expect(row('prometheus').getByText('Failed')).toBeInTheDocument();
    expect(row('prometheus').getByText(PROMETHEUS_ERROR)).toBeInTheDocument();
    expect(screen.getByText(/^No signal · last known .+ ago$/)).toBeInTheDocument();
  });

  it('before the first status, every row is no signal: none says it isn’t set up', () => {
    draw({ status: null, reach: 'loading', updated: null });
    for (const { id, setting } of [...SOURCES, CRON]) {
      const { variable } = setting;
      expect(row(id).getByText('No signal')).toBeInTheDocument();
      expect(row(id).queryByText('Not set up')).toBeNull();
      expect(row(id).getByText(variable)).toBeInTheDocument();
      expect(lampOf(id)).toHaveAttribute('data-state', 'unknown');
    }
  });

  it('says the addresses are set in .env, not here', () => {
    draw({ status: status('healthy') });
    expect(
      screen.getByText(
        'Each is set in JagHelm’s .env, not here: change one there, then restart JagHelm.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('the command palette finds Sources', () => {
  const settingsFound = (query) => {
    const groups = paletteIndex({
      status: null,
      pages: [],
      apps: [],
      sections: SETTINGS_SECTIONS,
      links: {},
      entityLink: () => ({}),
      navigate: () => {},
    });
    return (paletteSearch(groups, query).find((g) => g.id === 'settings')?.rows ?? []).map(
      (r) => r.href
    );
  };

  it.each([
    'prometheus',
    'kuma',
    'uptime kuma',
    'nut',
    'ups',
    'gitea',
    'cron',
    'reporters',
    'monitoring',
    'health',
    'sources',
  ])('“%s”', (query) => {
    expect(settingsFound(query)).toContain('/settings/sources');
  });
});
