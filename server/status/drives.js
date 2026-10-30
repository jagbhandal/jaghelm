// @ts-check
/**
 * Drive health in the status model (docs/superpowers/specs/2026-10-29-drive-health-design.md
 * §3, §5, §6): how one drive is judged, and how a node's drives are held when
 * they can't be read. Pure: no clock, no I/O, no module state, so the model
 * stays a function of its inputs (rules.js judgeNode calls it).
 *
 * Each drive is its own condition on its node, keyed `drive:<node>:<device>`
 * (the precedent is `pool:<name>`): its own level, hysteresis, push grouping
 * and snapshot entry. The node's own state is the worst of its readings and its
 * drives; nothing here keys or pushes a node-level roll-up.
 *
 * A drive's level (drives.js reads the facts, §4):
 *
 *   crit   its health check failed; an NVMe's critical warning is set; an
 *          NVMe's media errors grew over the window
 *   warn   a SATA drive's reallocated, pending or offline-uncorrectable
 *          sector count grew over the window; an NVMe's spare is at or below
 *          its threshold
 *   temp   warn / crit lines by kind (thresholds.js driveTemp), with the
 *          model's hysteresis; only `temperature_type="current"` is read
 *
 * A counter is judged by its growth over the window, never "above zero": the
 * counts only rise, so a stable pile of remapped sectors is not an incident
 * and a drive that is still remapping is. With no history there is no growth
 * and no alert (Prometheus's delta/increase has nothing to compare).
 */
import {
  atOrOver,
  inTemperatureUnits,
  lineNumber,
  shownTemperature,
  temperatureSymbol,
} from './readings.js';

export const DRIVE_PREFIX = 'drive:';

/** The condition key of a drive: `drive:<node>:<device>`. */
export const driveKey = (/** @type {string} */ node, /** @type {string} */ device) =>
  `${DRIVE_PREFIX}${node}:${device}`;

/** The window growth is judged over, in words (drives.js GROWTH_WINDOW). */
const WINDOW_WORDS = 'the last 7 days';

const LEVEL_WORD = /** @type {Record<string, string>} */ ({ warn: 'warning', crit: 'critical' });
const RANK = /** @type {Record<string, number>} */ ({ ok: 0, warn: 1, crit: 2 });

const plural = (/** @type {number} */ n, /** @type {string} */ one, /** @type {string} */ many) =>
  `${n} ${n === 1 ? one : many}`;

/** The SATA sector counters, in the order a reason lists them. */
const SECTORS = /** @type {const} */ ([
  ['reallocated', 'reallocated sector', 'reallocated sectors'],
  ['pending', 'pending sector', 'pending sectors'],
  ['uncorrectable', 'offline-uncorrectable sector', 'offline-uncorrectable sectors'],
]);

/**
 * The temperature lines for a drive: an NVMe's, else a SATA drive's (spinning
 * or solid state).
 * @param {{ type?: string }} drive
 * @param {import('./thresholds.js').Thresholds} thresholds
 */
export function driveTempLines(drive, thresholds) {
  return drive.type === 'nvme' ? thresholds.driveTemp.nvme : thresholds.driveTemp.sata;
}

/**
 * A temperature's level against a pair of lines, with hysteresis: a level
 * reached holds until the reading falls `band` below its line. The grid of
 * hundredths is the model's (readings.js atOrOver).
 * @param {number} value
 * @param {string | undefined} prev
 * @param {{ warn: number, crit: number }} lines
 * @param {number} band
 */
function tempLevel(value, prev, lines, band) {
  const over = (/** @type {number} */ line) => atOrOver(value, line, 1);
  if (over(lines.crit)) return 'crit';
  if (prev === 'crit' && over(lines.crit - band)) return 'crit';
  if (over(lines.warn)) return 'warn';
  if ((prev === 'warn' || prev === 'crit') && over(lines.warn - band)) return 'warn';
  return 'ok';
}

/**
 * One drive judged: `{ level, tempLevel, phrases }`. `phrases` are the
 * conditions that make it not ok, worst first, each `{ state, text }` where
 * `text` follows the subject ("failed its health check", "has 3 reallocated
 * sectors (grew in the last 7 days)"). `tempLevel` is the temperature's own
 * level, which the next cycle's hysteresis starts from.
 *
 * @param {any} drive  a record from drives.js
 * @param {{ prevTemp?: string, thresholds: import('./thresholds.js').Thresholds, units?: string }} ctx
 *   prevTemp: the temperature's own level, when the model kept one (only
 *   that seeds the temperature's hysteresis)
 */
export function judgeDrive(drive, { prevTemp, thresholds, units = 'metric' }) {
  /** @type {Array<{ state: string, text: string, order: number }>} */
  const found = [];
  const add = (/** @type {string} */ state, /** @type {string} */ text) =>
    found.push({ state, text, order: found.length });

  if (drive.smartPassed === false) add('crit', 'failed its health check');
  if (typeof drive.criticalWarning === 'number' && drive.criticalWarning > 0)
    add('crit', 'reports a critical warning');
  if (drive.mediaErrors?.grew === true)
    add('crit', `has media errors that grew in ${WINDOW_WORDS}`);
  for (const [key, one, many] of SECTORS) {
    const s = drive.sectors?.[key];
    if (s?.grew === true && Number.isFinite(s.count))
      add('warn', `has ${plural(s.count, one, many)} (grew in ${WINDOW_WORDS})`);
  }
  if (
    Number.isFinite(drive.availableSpare) &&
    Number.isFinite(drive.spareThreshold) &&
    drive.availableSpare <= drive.spareThreshold
  ) {
    add('warn', `has ${drive.availableSpare} % spare left (warning at ${drive.spareThreshold} %)`);
  }

  /** @type {string} */
  let temp = 'ok';
  const t = drive.temperature;
  if (Number.isFinite(t)) {
    const lines = driveTempLines(drive, thresholds);
    const band = thresholds.hysteresis.celsius;
    // Seeded only by the temperature's own last level: the drive's overall
    // level may be a sector warning and says nothing about the temperature.
    temp = tempLevel(t, prevTemp, lines, band);
    if (temp !== 'ok') {
      const enter = /** @type {number} */ (lines[/** @type {'warn' | 'crit'} */ (temp)]);
      // Judged in °C, written in the one units setting (#494).
      const shown = shownTemperature(t, { warn: lines.warn, crit: lines.crit, band }, units);
      const sym = temperatureSymbol(units);
      const at = (/** @type {number} */ c) => lineNumber(inTemperatureUnits(c, units));
      const word = LEVEL_WORD[temp];
      add(
        temp,
        atOrOver(t, enter, 1)
          ? `is at ${shown} (${word} above ${at(enter)} ${sym})`
          : `is at ${shown} (${word} until below ${at(enter - band)} ${sym})`
      );
    }
  }

  found.sort((a, b) => RANK[b.state] - RANK[a.state] || a.order - b.order);
  const level = found.length ? found[0].state : 'ok';
  return { level, tempLevel: temp, phrases: found.map(({ state, text }) => ({ state, text })) };
}

/** A drive's sentence for the node's reason line: "drive sdb failed its health check". */
export const driveSentence = (
  /** @type {string} */ device,
  /** @type {Array<{ text: string }>} */ phrases
) => `drive ${device} ${phrases.map((p) => p.text).join('; ')}`;

/** The drives' `type` words, for a client. */
export const DRIVE_TYPES = Object.freeze(['nvme', 'hdd', 'ssd', 'sata']);

/** The reason a blind node's source gives (and the push body). */
export const blindReason = (/** @type {string} */ name) => `Drive monitoring has no signal on ${name}`;

/** The source name of a node's drive monitoring: `drives-source:<node>`. */
export const DRIVES_SOURCE = 'drives-source:';

// Where a drive's condition sorts among a node's readings: after the disk and
// its storage pools (rules.js judgeNode puts a pool at 1.5).
const ORDER = 1.6;

const WORD = /** @type {Record<string, string>} */ ({ ok: 'Healthy', warn: 'Warning', crit: 'Critical' });

/**
 * A node's drives for one cycle: what rules.js judgeNode merges into the
 * node's verdict.
 *
 * `drives` says what this cycle knows (model.js drivesOf):
 *   mode 'off'    the module is off (JAGHELM_DRIVES=off): nothing is judged or
 *                 kept, and a drive the model held leaves, as any reading that
 *                 is no longer listed does
 *   mode 'unread' the drive read failed or has not run: what the model held is
 *                 kept as it is, so a missed read neither ends an episode nor
 *                 starts one
 *   mode 'read'   `node` is this node's slice of the read, or null when the
 *                 read had no series for it
 *
 * A node is blind when it had drives (the model holds a level for one) and the
 * read says it can no longer see them: its scrape is down, or its series are
 * gone while the exporter is not reporting zero devices. A drive's own
 * smartctl exit status never makes a node blind (the exporter serves cached
 * data for a drive it could not read, and a failing drive reports its
 * findings in the high bits): every drive whose data arrived is judged. A
 * blind node keeps its drives' levels, as an unread one does, and says so
 * (`blind`); that is a source of its own (model.js), never a condition of the
 * node. A node that never had drive data is neither blind nor anything else.
 *
 * A blind hold is timed like #469's: `held` serves when each drive's hold
 * began, and after 24 h (`holdOf` returns null) the drives are forgotten
 * silently and the node is no longer blind (`dropped`). A module switched off
 * drops what it held the same way, at once (`dropped`); push stays silent for
 * both (push/differ.js).
 *
 * Returns `{ levels, temps, conditions, found, list, blind, held, dropped, readingSeconds }`: the levels and
 * temperature levels to remember, the conditions to serve, the readings that
 * are not ok (for the node's reason and state), the drives for the entity
 * (null when this cycle judged none), whether the node is blind, when each
 * kept hold began, and whether held drives were forgotten this cycle.
 *
 * @param {{ holdOf?: (since: unknown) => number | null, prevHeld?: Record<string, number>, nodeKey: string, drives: { mode: 'off' | 'unread' | 'read', node?: any } | null | undefined, prevLevels: Record<string, string>, prevTemps: Record<string, string>, thresholds: import('./thresholds.js').Thresholds, units?: string }} ctx
 */
export function judgeNodeDrives({ nodeKey, drives, prevLevels, prevTemps, prevHeld = {}, holdOf, thresholds, units = 'metric' }) {
  /** @type {Record<string, string>} */
  const levels = {};
  /** @type {Record<string, string>} */
  const temps = {};
  /** @type {Record<string, string>} */
  const conditions = {};
  /** @type {Array<{ key: string, state: string, reason: string, order: number }>} */
  const found = [];
  /** @type {Record<string, number>} */
  const held = {};
  const out = { levels, temps, conditions, found, list: /** @type {any[] | null} */ (null), blind: false, held, dropped: false, readingSeconds: /** @type {number | undefined} */ (undefined) };
  const mode = drives?.mode ?? 'unread';
  const prefix = `${DRIVE_PREFIX}${nodeKey}:`;
  const heldKeys = Object.keys(prevLevels)
    .filter((k) => k.startsWith(prefix))
    .sort();
  if (mode === 'off') {
    out.dropped = heldKeys.length > 0;
    return out;
  }
  const slice = mode === 'read' ? (drives?.node ?? null) : null;
  const records = Array.isArray(slice?.drives) ? slice.drives : [];
  if (mode === 'read' && heldKeys.length > 0) {
    out.blind =
      slice === null ||
      slice.scrapeUp === false ||
      (records.length === 0 && slice.devices == null);
  } else if (mode === 'read') {
    out.blind = false;
  }

  if (mode !== 'read' || out.blind) {
    // Kept as the model held them. `unknown` marks a level held with no
    // reading, so push's snapshot keeps it (push/snapshot.js buildHosts).
    for (const key of heldKeys) {
      const before = prevLevels[key];
      // A blind hold is timed (24 h, #469); an unread one is frozen as it is.
      let since = prevHeld[key];
      if (out.blind && holdOf) {
        const start = holdOf(since);
        if (start === null) {
          out.dropped = true;
          continue;
        }
        since = start;
      }
      if (Number.isFinite(since)) held[key] = since;
      levels[key] = before;
      conditions[key] = 'unknown';
      if (prevTemps[key]) temps[key] = prevTemps[key];
      if (before !== 'warn' && before !== 'crit') continue;
      found.push({
        key,
        state: before,
        reason: `drive ${key.slice(prefix.length)}: no reading (${LEVEL_WORD[before]} held)`,
        order: ORDER,
      });
    }
    if (out.blind && Object.keys(levels).length === 0) out.blind = false;
    return out;
  }

  const list = [];
  const sorted = [...records].sort((a, b) => (a.device < b.device ? -1 : a.device > b.device ? 1 : 0));
  for (const drive of sorted) {
    const key = driveKey(nodeKey, drive.device);
    const j = judgeDrive(drive, { prevTemp: prevTemps[key], thresholds, units });
    levels[key] = j.level;
    conditions[key] = j.level;
    if (j.tempLevel !== 'ok') temps[key] = j.tempLevel;
    const reason = j.level === 'ok' ? 'Healthy' : driveSentence(drive.device, j.phrases);
    if (j.level !== 'ok') found.push({ key, state: j.level, reason, order: ORDER });
    list.push({ ...drive, key, state: j.level, word: WORD[j.level], reason });
  }
  out.list = list;
  // How often the exporter refreshes its readings, when the target declares it
  // (drives.js readingSeconds): display data, judged by nothing.
  if (Number.isFinite(slice?.readingSeconds)) out.readingSeconds = slice.readingSeconds;
  return out;
}
