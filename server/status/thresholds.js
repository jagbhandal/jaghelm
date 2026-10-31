// @ts-check
/**
 * The server's one threshold config (spec §6.1, #290): every number the status
 * model uses to judge a reading. Push sends what the model judges (#292), so
 * it has no lines of its own.
 *
 * Usage lines are fractions of 1, as push has always compared them (a node's
 * `cpu`, `memPercent` and `diskPercent` arrive as percent strings and are read
 * as `n / 100`, coerceFraction in rules.js). Temperature is in °C.
 *
 * Settings → Notifications sets the lines a person edits (#320, spec §7):
 * CPU's, memory's, the disk's, the temperature's and the drive temperatures'
 * (an NVMe's and a SATA drive's), saved in thresholds.json
 * (status/thresholdTable.js, thresholdsFile.js). Before it, four values could
 * be changed by hand in display-config.json under `pushThresholds` ({ cpu,
 * mem, disk, hysteresis }, fractions): the warn lines of CPU, memory and disk
 * and the percentage hysteresis. Those still count until Settings saves
 * thresholds.json once; from then on its lines replace them, and only the
 * hand-edited hysteresis is still read from there.
 */

/**
 * @typedef {{
 *   cpu: { warn: number, cycles: number, holdMs?: number },
 *   mem: { warn: number },
 *   disk: { warn: number, crit: number },
 *   temp: { warn: number, crit: number },
 *   driveTemp: { nvme: { warn: number, crit: number }, sata: { warn: number, crit: number } },
 *   hysteresis: { fraction: number, celsius: number },
 *   pending: { cycles: number },
 * }} Thresholds
 */

/** @type {Readonly<Thresholds>} */
export const DEFAULT_THRESHOLDS = Object.freeze({
  // Warn once CPU has been at or above the line for `cycles` refresh cycles in
  // a row AND for `holdMs` since the run began. The hold is 30 minutes (#764, spec §8): a backup night's burst
  // does not page, a half hour of it does. It is time, not a count of cycles,
  // so a changed refresh interval does not change it; `cycles` stays as the
  // floor (a run is never one reading). Not editable in Settings.
  cpu: Object.freeze({ warn: 0.9, cycles: 2, holdMs: 1_800_000 }),
  mem: Object.freeze({ warn: 0.9 }),
  // A node's disk and a Proxmox storage pool.
  disk: Object.freeze({ warn: 0.9, crit: 0.95 }),
  // The node's hottest sensor, °C.
  temp: Object.freeze({ warn: 75, crit: 85 }),
  // A drive's own temperature, °C: an NVMe's, and a SATA drive's, spinning or
  // solid state (drives.js, status/drives.js). Drives never read the node's.
  driveTemp: Object.freeze({
    nvme: Object.freeze({ warn: 70, crit: 80 }),
    sata: Object.freeze({ warn: 55, crit: 60 }),
  }),
  // A level holds until the reading falls this far below its line.
  hysteresis: Object.freeze({ fraction: 0.05, celsius: 5 }),
  // A Kuma monitor pending for this many cycles in a row is a warning: one
  // pending cycle (Kuma retrying a check) is not.
  pending: Object.freeze({ cycles: 2 }),
});

/** @param {unknown} v */
const num = (v) => typeof v === 'number' && Number.isFinite(v);

/** A percent line as a fraction of 1, to a hundredth of a percent (87.5 → 0.875). */
const fraction = (/** @type {number} */ pct) => Math.round(pct * 100) / 10000;

/**
 * The thresholds in force: the defaults, with the saved lines laid over them.
 *
 * `saved` is thresholds.json's, as Settings → Notifications saves it (#320):
 * a metric each with its own lines, in percent and °C, already checked
 * (status/thresholdTable.js readThresholdTable); a metric it doesn't name
 * keeps its defaults. Null when there is no such file (or one JagHelm can't
 * use): then display-config.json's `pushThresholds` is laid over the
 * defaults, as before #320. Each of its four keys counts when it is a number,
 * as push has always read it; anything else keeps the default. A disk warn
 * line set above the crit line moves the crit line up to it. Its
 * `hysteresis` counts either way.
 *
 * @param {unknown} pushThresholds  display-config.json's `pushThresholds`
 * @param {import('./thresholdTable.js').SavedLines | null} [saved]  thresholds.json's lines
 * @returns {Thresholds}
 */
export function resolveThresholds(pushThresholds, saved = null) {
  const t = /** @type {Record<string, unknown>} */ (
    pushThresholds && typeof pushThresholds === 'object' ? pushThresholds : {}
  );
  const d = DEFAULT_THRESHOLDS;
  if (saved) {
    return {
      cpu: {
        warn: saved.cpu ? fraction(saved.cpu.warn) : d.cpu.warn,
        cycles: d.cpu.cycles,
        holdMs: d.cpu.holdMs,
      },
      mem: { warn: saved.mem ? fraction(saved.mem.warn) : d.mem.warn },
      disk: saved.disk
        ? { warn: fraction(saved.disk.warn), crit: fraction(/** @type {number} */ (saved.disk.crit)) }
        : { warn: d.disk.warn, crit: d.disk.crit },
      temp: saved.temp
        ? { warn: saved.temp.warn, crit: /** @type {number} */ (saved.temp.crit) }
        : { warn: d.temp.warn, crit: d.temp.crit },
      driveTemp: {
        nvme: saved.nvmeTemp
          ? { warn: saved.nvmeTemp.warn, crit: /** @type {number} */ (saved.nvmeTemp.crit) }
          : { ...d.driveTemp.nvme },
        sata: saved.sataTemp
          ? { warn: saved.sataTemp.warn, crit: /** @type {number} */ (saved.sataTemp.crit) }
          : { ...d.driveTemp.sata },
      },
      hysteresis: {
        fraction: num(t.hysteresis) ? /** @type {number} */ (t.hysteresis) : d.hysteresis.fraction,
        celsius: d.hysteresis.celsius,
      },
      pending: { cycles: d.pending.cycles },
    };
  }
  const diskWarn = num(t.disk) ? /** @type {number} */ (t.disk) : d.disk.warn;
  return {
    cpu: {
      warn: num(t.cpu) ? /** @type {number} */ (t.cpu) : d.cpu.warn,
      cycles: d.cpu.cycles,
      holdMs: d.cpu.holdMs,
    },
    mem: { warn: num(t.mem) ? /** @type {number} */ (t.mem) : d.mem.warn },
    disk: { warn: diskWarn, crit: Math.max(d.disk.crit, diskWarn) },
    temp: { warn: d.temp.warn, crit: d.temp.crit },
    driveTemp: { nvme: { ...d.driveTemp.nvme }, sata: { ...d.driveTemp.sata } },
    hysteresis: {
      fraction: num(t.hysteresis) ? /** @type {number} */ (t.hysteresis) : d.hysteresis.fraction,
      celsius: d.hysteresis.celsius,
    },
    pending: { cycles: d.pending.cycles },
  };
}
