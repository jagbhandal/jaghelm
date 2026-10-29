/**
 * A node's drives as its detail draws them (drive health, #728; design
 * docs/superpowers/specs/2026-10-29-drive-health-design.md §8): the model's
 * `drives` on a node's entity (server/status/drives.js: one record per drive
 * with its server-judged `state`, `word` and `reason`, and the readings), made
 * into the rows of the Drives block (src/ui/detail-drives.jsx). Nothing here
 * judges a drive; the model did. A serial number is never in a record (the
 * server never reads one), and nothing here reads one either.
 *
 *   null     the node has no drive data (and holds none): no block at all, as
 *            an install without smartctl series has none today
 *   a view   `{ count, summary, tone, standby, rows }`
 *
 * Each row: `{ key, device, name, state, word, said, temperature, line,
 * details }`. `state` is the model's while the status is fresh, no signal while
 * stale (drawnState); `word` is shown only when the drive isn't healthy
 * (healthy stays quiet), `said` is the model's word always (a screen reader's); `line` is the model and what to know in a few words; `details`
 * (what a row expands to) is `[{ key, label, value, state? }]`, none for a
 * drive the model holds with no reading.
 *
 * A node that was reading drives and can't any more (blind) has no `drives`
 * list, but its conditions still hold each drive's `unknown` level
 * (`drive:<node>:<device>`): those are rows in the no signal state, with no
 * numbers (nothing was read).
 *
 * `note` is the footnote under the block, or null: with a declared refresh
 * interval (`driveReadingSeconds` on the entity, #732) one line for both facts,
 * "Readings refresh about every hour, on their own schedule, not with this
 * page. A sleeping drive shows its last reading."; without one, only the
 * standby sentence, as before. `cadence` is true when it carries the interval.
 *
 * `standby` is true on a node with any non-NVMe drive: the exporter serves the
 * last reading of a drive asleep, which JagHelm can't tell from a fresh one
 * (design §4, §8), so the block says so.
 */
import { shownReading } from '../../../server/status/readings.js';
import { DRIVE_PREFIX } from '../../../server/status/drives.js';
import { localeOf } from '../../util/format.js';
import { drawnState } from '../statusFreshness.js';

/** The footnote when only standby is said (no interval declared). */
export const STANDBY_NOTE = 'Sleeping drives show their last reading';

/**
 * "every 10 minutes", "every hour", "every 3 hours": a refresh interval in
 * seconds as the footnote says it, or null for anything that isn't a positive
 * whole number of seconds.
 *
 * @param {unknown} seconds
 */
export function everyWords(seconds) {
  if (!Number.isInteger(seconds) || seconds <= 0) return null;
  const n = /** @type {number} */ (seconds);
  const unit = (count, one, many) => (count === 1 ? `every ${one}` : `every ${count} ${many}`);
  if (n % 86_400 === 0) return n === 86_400 ? 'every day' : unit(n / 86_400, 'day', 'days');
  if (n % 3600 === 0) return n === 3600 ? 'every hour' : unit(n / 3600, 'hour', 'hours');
  if (n % 60 === 0) return unit(n / 60, 'minute', 'minutes');
  return unit(n, 'second', 'seconds');
}

/**
 * The footnote under the Drives block.
 *
 * @param {number | null | undefined} seconds  the declared refresh interval
 * @param {boolean} standby  a drive that may sleep is listed
 * @returns {string | null}
 */
export function driveNote(seconds, standby) {
  const every = everyWords(seconds);
  if (every === null) return standby ? STANDBY_NOTE : null;
  // No closing full stop, as the other footnotes have none.
  const refresh = `Readings refresh about ${every}, on their own schedule, not with this page`;
  return standby ? `${refresh}. A sleeping drive shows its last reading` : refresh;
}

const WINDOW_WORDS = 'the last 7 days';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** Each drive kind as the expanded row names it. */
const TYPE_WORDS = Object.freeze({
  nvme: 'NVMe',
  hdd: 'SATA hard disk',
  ssd: 'SATA SSD',
  sata: 'SATA',
});

const WORD = Object.freeze({
  warn: 'Warning',
  crit: 'Critical',
  unknown: 'No signal',
});

/** A whole number in the user's locale: "5,763". */
const whole = (n) => new Intl.NumberFormat(localeOf(), { maximumFractionDigits: 0 }).format(n);

/** "42 °C", as a node's meter prints a temperature (rounded down, #450). */
export const driveTemperature = (n) => (finite(n) ? `${shownReading(n)} °C` : null);

/** Power-on time in whole hours: "5,763 h". */
const powerOn = (seconds) => (finite(seconds) ? `${whole(seconds / 3600)} h` : null);

/** "3 reallocated sectors" / "1 pending sector", with whether it grew. */
function sectorText(count, one, many, grew) {
  const base = `${whole(count)} ${count === 1 ? one : many}`;
  return grew ? `${base}, grew in ${WINDOW_WORDS}` : base;
}

// The sector kinds in the expanded row, a word each: "0 reallocated · 0 pending".
const SECTOR_SHORT = Object.freeze({
  reallocated: 'reallocated',
  pending: 'pending',
  uncorrectable: 'uncorrectable',
});

const SECTORS = [
  ['reallocated', 'reallocated sector', 'reallocated sectors'],
  ['pending', 'pending sector', 'pending sectors'],
  ['uncorrectable', 'offline-uncorrectable sector', 'offline-uncorrectable sectors'],
];

/** A SATA drive's sector counts in a few words, or null when none was read. */
function sectorsLine(sectors) {
  if (!isObject(sectors)) return null;
  const read = SECTORS.filter(([key]) => finite(sectors[key]?.count));
  if (read.length === 0) return null;
  const any = read.filter(([key]) => sectors[key].count > 0);
  if (any.length === 0) return 'no bad sectors';
  return any
    .map(([key, one, many]) =>
      sectorText(sectors[key].count, one, many, sectors[key].grew === true)
    )
    .join(' · ');
}

/** What the model said, without the "drive sdb " that starts a drive's sentence. */
function sentenceOf(drive) {
  const reason = typeof drive.reason === 'string' ? drive.reason : '';
  const lead = `drive ${drive.device} `;
  return reason.startsWith(lead) ? reason.slice(lead.length) : reason;
}

/** The line under a drive's name: its model, then what is worth knowing in a few words. */
function lineOf(drive) {
  const model = typeof drive.model === 'string' && drive.model !== '' ? drive.model : null;
  let said = null;
  if (drive.state === 'warn' || drive.state === 'crit') said = sentenceOf(drive) || null;
  else if (drive.type === 'nvme')
    said = finite(drive.percentageUsed) ? `${whole(drive.percentageUsed)} % worn` : null;
  else said = sectorsLine(drive.sectors);
  return [model, said].filter(Boolean).join(' · ') || null;
}

const detail = (key, label, value, state) =>
  value == null || value === '' ? null : { key, label, value, ...(state ? { state } : {}) };

/** What a row expands to: what the server delivered, never a serial number. */
function detailsOf(drive) {
  const nvme = drive.type === 'nvme';
  const out = [
    detail('model', 'Model', drive.model),
    detail('type', 'Type', TYPE_WORDS[drive.type] ?? null),
    detail('power', 'Power-on', powerOn(drive.powerOnSeconds)),
    drive.smartPassed === false
      ? detail('health', 'Health check', 'Failed', 'crit')
      : drive.smartPassed === true
        ? detail('health', 'Health check', 'Passed')
        : null,
  ];
  if (nvme) {
    out.push(
      detail(
        'wear',
        'Wear',
        finite(drive.percentageUsed) ? `${whole(drive.percentageUsed)} % used` : null
      ),
      detail(
        'spare',
        'Spare',
        finite(drive.availableSpare)
          ? `${whole(drive.availableSpare)} %${finite(drive.spareThreshold) ? ` (warning at ${whole(drive.spareThreshold)} %)` : ''}`
          : null,
        finite(drive.availableSpare) &&
          finite(drive.spareThreshold) &&
          drive.availableSpare <= drive.spareThreshold
          ? 'warn'
          : null
      ),
      finite(drive.criticalWarning)
        ? detail(
            'critical',
            'Critical warning',
            drive.criticalWarning > 0 ? 'Set' : 'None',
            drive.criticalWarning > 0 ? 'crit' : null
          )
        : null,
      isObject(drive.mediaErrors) && finite(drive.mediaErrors.count)
        ? detail(
            'media',
            'Media errors',
            drive.mediaErrors.grew
              ? `${whole(drive.mediaErrors.count)}, grew in ${WINDOW_WORDS}`
              : whole(drive.mediaErrors.count),
            drive.mediaErrors.grew ? 'crit' : null
          )
        : null
    );
  } else if (isObject(drive.sectors)) {
    const read = SECTORS.filter(([key]) => finite(drive.sectors[key]?.count));
    if (read.length > 0) {
      const grew = read.some(([key]) => drive.sectors[key].grew === true);
      out.push(
        detail(
          'sectors',
          'Bad sectors',
          read
            .map(([key]) => {
              const { count, grew: up } = drive.sectors[key];
              return `${whole(count)} ${SECTOR_SHORT[key]}${up ? ` (grew in ${WINDOW_WORDS})` : ''}`;
            })
            .join(' · '),
          grew ? 'warn' : null
        )
      );
    }
  }
  return out.filter(Boolean);
}

/** The heading's count: "3", or "3 · 1 failing · 1 warning". */
function summaryOf(rows) {
  const n = (state) => rows.filter((r) => r.rawState === state).length;
  const parts = [String(rows.length)];
  if (n('crit')) parts.push(`${n('crit')} failing`);
  if (n('warn')) parts.push(`${n('warn')} warning`);
  if (n('unknown')) parts.push(`${n('unknown')} no signal`);
  return parts.join(' · ');
}

const RANK = { crit: 3, warn: 2, unknown: 1, ok: 0 };

/**
 * The Drives block's view for a node's entity, or null when it has no drive
 * data.
 *
 * @param {any} entity  the model's node entity
 * @param {any} [freshness]  the status's freshness (statusFreshness.js)
 */
export function driveView(entity, freshness) {
  const drives = Array.isArray(entity?.drives)
    ? entity.drives.filter((d) => isObject(d) && typeof d.device === 'string')
    : [];
  const stale = Boolean(freshness?.stale);
  let rows;
  if (drives.length > 0) {
    rows = drives.map((d) => ({
      key: d.device,
      device: d.device,
      name: d.device,
      rawState: d.state,
      state: drawnState(d.state, freshness),
      // A stale status never speaks in the model's words (#480): the lamp is
      // no signal, so the word is too, and what was last known stays in the
      // line and the details.
      word: stale ? WORD.unknown : d.state === 'ok' ? null : (d.word ?? WORD[d.state] ?? null),
      said: stale ? WORD.unknown : (d.word ?? WORD[d.state] ?? 'Healthy'),
      temperature: driveTemperature(d.temperature),
      line: lineOf(d),
      details: detailsOf(d),
      nvme: d.type === 'nvme',
      model: typeof d.model === 'string' ? d.model : null,
    }));
  } else {
    // Blind: held levels with no reading, as the model's conditions say.
    const prefix = `${DRIVE_PREFIX}${entity?.node ?? ''}:`;
    const held = Object.entries(isObject(entity?.conditions) ? entity.conditions : {})
      .filter(([key, state]) => key.startsWith(prefix) && state === 'unknown')
      .map(([key]) => key.slice(prefix.length))
      .filter(Boolean)
      .sort();
    if (held.length === 0) return null;
    rows = held.map((device) => ({
      key: device,
      device,
      name: device,
      rawState: 'unknown',
      state: 'unknown',
      word: WORD.unknown,
      said: WORD.unknown,
      temperature: null,
      line: 'No reading',
      details: [],
      nvme: false,
      model: null,
    }));
  }
  const worst = rows.reduce((w, r) => (RANK[r.state] > RANK[w] ? r.state : w), 'ok');
  // Any drive that is not NVMe may be asleep (design §8): known drives only.
  const standby = drives.length > 0 && drives.some((d) => d.type !== 'nvme');
  // The interval is shown for read drives only: held rows have no reading to date.
  const every = drives.length > 0 ? everyWords(entity?.driveReadingSeconds) : null;
  return {
    count: rows.length,
    summary: summaryOf(rows),
    tone: worst,
    standby,
    note: driveNote(every === null ? null : entity.driveReadingSeconds, standby),
    cadence: every !== null,
    rows: rows.map((row) => {
      const { rawState: _raw, nvme: _nvme, model: _model, ...shown } = row;
      return shown;
    }),
  };
}

/**
 * The charts' drive lines for a node (historySeries.js): `[{ device,
 * temperature }]` for each drive with a temperature, or null when the node has
 * no drive data (its charts then ask for nothing more than today).
 *
 * @param {any} entity
 */
export function driveTemps(entity) {
  const drives = Array.isArray(entity?.drives) ? entity.drives : [];
  const list = drives
    .filter((d) => isObject(d) && typeof d.device === 'string')
    .map((d) => ({ device: d.device, temperature: finite(d.temperature) ? d.temperature : null }));
  return list.length > 0 ? list : null;
}
