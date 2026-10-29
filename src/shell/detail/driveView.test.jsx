import { describe, it, expect } from 'vitest';
import { driveNote, driveTemps, driveView, everyWords, STANDBY_NOTE } from './driveView.js';
import { chartTarget } from './entityDetail.js';
import { hdd, nasWith, nasWithoutDrives, nvme, sectors } from '../../testing/driveFixtures.js';

// A node's Drives block as a view (#728): the model's drives, as the server
// judged them, made into rows. Every status here is the real model's.

const view = (drives, opts, freshness) => driveView(nasWith(drives, opts).entity, freshness);
const row = (v, device) => v.rows.find((r) => r.device === device);

describe('a node with healthy SATA drives', () => {
  const v = view([hdd('sda', { temperature: 40 }), hdd('sdb', { temperature: 42.6 }), hdd('sdc')]);

  it('has a quiet row each: the name, the temperature rounded down, the model and no bad sectors', () => {
    expect(v.count).toBe(3);
    expect(v.summary).toBe('3');
    expect(v.tone).toBe('ok');
    expect(v.rows.map((r) => r.device)).toEqual(['sda', 'sdb', 'sdc']);
    expect(row(v, 'sdb')).toMatchObject({
      state: 'ok',
      word: null,
      temperature: '42 °C',
      line: 'ST8000VN004 · no bad sectors',
    });
  });

  it('notes that a sleeping drive shows its last reading', () => {
    expect(v.standby).toBe(true);
  });

  it('expands to the model, type, power-on hours and the health check, with the bad sectors', () => {
    expect(row(v, 'sda').details.map((d) => [d.label, d.value])).toEqual([
      ['Model', 'ST8000VN004'],
      ['Type', 'SATA hard disk'],
      ['Power-on', '5,763 h'],
      ['Health check', 'Passed'],
      ['Bad sectors', '0 reallocated · 0 pending · 0 uncorrectable'],
    ]);
  });
});

describe('a drive that is failing or warm', () => {
  it('a failed health check is critical, said as the model says it, and the count says who', () => {
    const v = view([hdd('sda'), hdd('sdb', { smartPassed: false }), hdd('sdc')]);
    expect(v.summary).toBe('3 · 1 failing');
    expect(v.tone).toBe('crit');
    expect(row(v, 'sdb')).toMatchObject({
      state: 'crit',
      word: 'Critical',
      line: 'ST8000VN004 · failed its health check',
    });
    expect(row(v, 'sdb').details.find((d) => d.key === 'health')).toMatchObject({
      value: 'Failed',
      state: 'crit',
    });
  });

  it('growing sector counts are a warning, with the growth in the details', () => {
    const v = view([hdd('sda', { sectors: sectors({ reallocated: { count: 3, grew: true } }) })]);
    expect(row(v, 'sda')).toMatchObject({ state: 'warn', word: 'Warning' });
    expect(row(v, 'sda').line).toBe(
      'ST8000VN004 · has 3 reallocated sectors (grew in the last 7 days)'
    );
    expect(row(v, 'sda').details.find((d) => d.key === 'sectors')).toMatchObject({
      value: '3 reallocated (grew in the last 7 days) · 0 pending · 0 uncorrectable',
      state: 'warn',
    });
    expect(v.summary).toBe('1 · 1 warning');
  });

  it('a drive over its temperature line is a warning with the reading in its words', () => {
    const v = view([hdd('sda', { temperature: 57 })]);
    expect(row(v, 'sda')).toMatchObject({ state: 'warn', temperature: '57 °C' });
    expect(row(v, 'sda').line).toContain('57 °C');
  });

  it('a stable pile of remapped sectors is plain text, not a warning', () => {
    const v = view([hdd('sda', { sectors: sectors({ reallocated: { count: 8, grew: false } }) })]);
    expect(row(v, 'sda')).toMatchObject({ state: 'ok', word: null });
    expect(row(v, 'sda').line).toBe('ST8000VN004 · 8 reallocated sectors');
  });
});

describe('an NVMe drive', () => {
  const v = view([nvme('nvme0')]);
  it('shows its wear and has no standby note (it does not sleep)', () => {
    expect(row(v, 'nvme0').line).toBe('CT1000P310SSD8 · 2 % worn');
    expect(v.standby).toBe(false);
  });
  it('expands to wear, spare, critical warning and media errors', () => {
    expect(row(v, 'nvme0').details.map((d) => [d.label, d.value])).toEqual([
      ['Model', 'CT1000P310SSD8'],
      ['Type', 'NVMe'],
      ['Power-on', '5,465 h'],
      ['Health check', 'Passed'],
      ['Wear', '2 % used'],
      ['Spare', '100 % (warning at 5 %)'],
      ['Critical warning', 'None'],
      ['Media errors', '0'],
    ]);
  });
  it('an NVMe beside a SATA drive keeps the note: the SATA one may sleep', () => {
    expect(view([nvme('nvme0'), hdd('sda')]).standby).toBe(true);
  });
});

describe('what the status says is stale, blind or absent', () => {
  it('a stale status draws every row as no signal, in word and lamp, and keeps what was last known', () => {
    const v = view([hdd('sda'), hdd('sdb', { smartPassed: false })], {}, { stale: true });
    expect(v.rows.map((r) => r.state)).toEqual(['unknown', 'unknown']);
    // Lamp, word and what a screen reader hears agree (never "sda, Healthy" beside a steel lamp).
    expect(v.rows.map((r) => [r.word, r.said])).toEqual([
      ['No signal', 'No signal'],
      ['No signal', 'No signal'],
    ]);
    expect(row(v, 'sdb').line).toMatch(/health check/);
    expect(row(v, 'sdb').details.length).toBeGreaterThan(0);
    expect(v.tone).toBe('unknown');
  });

  it('a node blind to its drives keeps a no signal row each, with no numbers and nothing to expand', () => {
    const v = view([hdd('sda'), hdd('sdb')], { blind: true });
    expect(v.rows).toEqual([
      expect.objectContaining({
        device: 'sda',
        state: 'unknown',
        word: 'No signal',
        temperature: null,
        details: [],
      }),
      expect.objectContaining({
        device: 'sdb',
        state: 'unknown',
        word: 'No signal',
        temperature: null,
        details: [],
      }),
    ]);
    expect(v.summary).toBe('2 · 2 no signal');
    expect(v.standby).toBe(false);
  });

  it('no drive data is no block at all, and asks the charts for nothing more', () => {
    const { entity } = nasWithoutDrives();
    expect(entity.drives).toBeUndefined();
    expect(driveView(entity)).toBeNull();
    expect(driveTemps(entity)).toBeNull();
    expect(chartTarget(entity, null)).toEqual({ kind: 'node', entity: 'nas' });
    expect(driveView(null)).toBeNull();
  });
});

describe('what is never shown', () => {
  it('no serial number: a record with one (it never should) loses it, and none is in any view', () => {
    const { entity } = nasWith([
      hdd('sda', { serial_number: 'SN-SECRET-123', serial: 'SN-SECRET-123' }),
    ]);
    const v = driveView(entity);
    expect(JSON.stringify(v)).not.toMatch(/SN-SECRET|serial/i);
    expect(JSON.stringify(driveTemps(entity))).not.toMatch(/SN-SECRET|serial/i);
  });
});

describe('the charts read the temperatures', () => {
  it('a node with drives adds them to its chart target; a drive with no reading says null', () => {
    const { entity } = nasWith([
      hdd('sda', { temperature: 41 }),
      hdd('sdb', { temperature: null }),
    ]);
    expect(chartTarget(entity, null)).toEqual({
      kind: 'node',
      entity: 'nas',
      drives: [
        { device: 'sda', temperature: 41 },
        { device: 'sdb', temperature: null },
      ],
    });
  });
});

describe('how often the readings refresh (#732)', () => {
  it('says an interval in words', () => {
    expect(
      [60, 90, 600, 3600, 5400, 7200, 10_800, 86_400, 45, 1].map(everyWords)
    ).toEqual([
      'every minute',
      'every 90 seconds',
      'every 10 minutes',
      'every hour',
      'every 90 minutes',
      'every 2 hours',
      'every 3 hours',
      'every 24 hours',
      'every 45 seconds',
      'every second',
    ]);
    for (const bad of [0, -60, 1.5, NaN, null, undefined, '1h']) expect(everyWords(bad)).toBeNull();
  });

  it('the footnote is one line for both facts, or the cadence alone for drives that never sleep', () => {
    expect(driveNote(3600, true)).toBe(
      'Readings refresh about every hour, on their own schedule, not with this page. A sleeping drive shows its last reading.'
    );
    expect(driveNote(600, false)).toBe(
      'Readings refresh about every 10 minutes, on their own schedule, not with this page.'
    );
    // No interval: exactly today's footnote, or none.
    expect(driveNote(null, true)).toBe(STANDBY_NOTE);
    expect(STANDBY_NOTE).toBe('Sleeping drives show their last reading');
    expect(driveNote(undefined, false)).toBeNull();
    expect(driveNote(0, true)).toBe(STANDBY_NOTE);
  });

  it('a node that declares its interval has the line; the NVMe-only node does not say sleeping', () => {
    const nas = view([hdd('sda'), nvme('nvme0')], { readingSeconds: 3600 });
    expect(nas.note).toMatch(/^Readings refresh about every hour.*A sleeping drive shows its last reading\.$/);
    expect(nas.cadence).toBe(true);
    const pve = view([nvme('nvme0')], { readingSeconds: 600 });
    expect(pve.note).toBe(
      'Readings refresh about every 10 minutes, on their own schedule, not with this page.'
    );
    expect(pve.standby).toBe(false);
  });

  it('without the label the note is the standby sentence and the view is what it was', () => {
    const v = view([hdd('sda')]);
    expect(v.note).toBe(STANDBY_NOTE);
    expect(v.cadence).toBe(false);
    expect(view([nvme('nvme0')]).note).toBeNull();
  });

  it('a node that cannot read its drives (blind) names no cadence', () => {
    const v = view([hdd('sda')], { blind: true, readingSeconds: 3600 });
    expect(v.cadence).toBe(false);
    expect(v.note).toBeNull();
  });
});
