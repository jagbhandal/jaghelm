// @ts-check
/**
 * The server's one threshold config (spec §6.1, #290): every number the status
 * model and push use to judge a reading. Push's host thresholds are a view of
 * it (pushThresholdsOf), so the two can never disagree about where a line is.
 *
 * Usage lines are fractions of 1, as push has always compared them (a node's
 * `cpu`, `memPercent` and `diskPercent` arrive as percent strings and are read
 * as `n / 100`, coerceFraction in push/snapshot.js). Temperature is in °C.
 *
 * Today only the four push values can be changed, by hand, in
 * display-config.json under `pushThresholds` ({ cpu, mem, disk, hysteresis },
 * fractions): those are the warn lines of CPU, memory and disk and the
 * percentage hysteresis, for push and the model alike. Settings → Notifications
 * edits the whole table from Phase 3 (spec §7).
 */

/**
 * @typedef {{
 *   cpu: { warn: number, cycles: number },
 *   mem: { warn: number },
 *   disk: { warn: number, crit: number },
 *   temp: { warn: number, crit: number },
 *   hysteresis: { fraction: number, celsius: number },
 *   pending: { cycles: number },
 * }} Thresholds
 */

/** @type {Readonly<Thresholds>} */
export const DEFAULT_THRESHOLDS = Object.freeze({
  // Warn once CPU has been at or above the line for `cycles` refresh cycles in a row.
  cpu: Object.freeze({ warn: 0.9, cycles: 2 }),
  mem: Object.freeze({ warn: 0.9 }),
  // A node's disk and a Proxmox storage pool.
  disk: Object.freeze({ warn: 0.9, crit: 0.95 }),
  // The node's hottest sensor, °C.
  temp: Object.freeze({ warn: 75, crit: 85 }),
  // A level holds until the reading falls this far below its line.
  hysteresis: Object.freeze({ fraction: 0.05, celsius: 5 }),
  // A Kuma monitor pending for this many cycles in a row is a warning: one
  // pending cycle (Kuma retrying a check) is not.
  pending: Object.freeze({ cycles: 2 }),
});

/** @param {unknown} v */
const num = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * The thresholds in force: the defaults, with display-config.json's
 * `pushThresholds` laid over them. Each of its four keys counts when it is a
 * number, as push has always read it; anything else keeps the default. A disk
 * warn line set above the crit line moves the crit line up to it.
 *
 * @param {unknown} pushThresholds  display-config.json's `pushThresholds`
 * @returns {Thresholds}
 */
export function resolveThresholds(pushThresholds) {
  const t = /** @type {Record<string, unknown>} */ (
    pushThresholds && typeof pushThresholds === 'object' ? pushThresholds : {}
  );
  const d = DEFAULT_THRESHOLDS;
  const diskWarn = num(t.disk) ? /** @type {number} */ (t.disk) : d.disk.warn;
  return {
    cpu: { warn: num(t.cpu) ? /** @type {number} */ (t.cpu) : d.cpu.warn, cycles: d.cpu.cycles },
    mem: { warn: num(t.mem) ? /** @type {number} */ (t.mem) : d.mem.warn },
    disk: { warn: diskWarn, crit: Math.max(d.disk.crit, diskWarn) },
    temp: { warn: d.temp.warn, crit: d.temp.crit },
    hysteresis: {
      fraction: num(t.hysteresis) ? /** @type {number} */ (t.hysteresis) : d.hysteresis.fraction,
      celsius: d.hysteresis.celsius,
    },
    pending: { cycles: d.pending.cycles },
  };
}

/**
 * Push's host thresholds (push/differ.js), read from the same config: CPU,
 * memory and disk fire at their warn lines and clear `hysteresis` below them.
 *
 * @param {Thresholds} thresholds
 * @returns {{ cpu: number, mem: number, disk: number, hysteresis: number }}
 */
export function pushThresholdsOf(thresholds) {
  return {
    cpu: thresholds.cpu.warn,
    mem: thresholds.mem.warn,
    disk: thresholds.disk.warn,
    hysteresis: thresholds.hysteresis.fraction,
  };
}
