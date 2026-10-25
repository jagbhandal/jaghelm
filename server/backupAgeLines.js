/**
 * Where a backup's age turns amber and red (#675): whole hours since its last
 * good run, `crit` over `warn`. Kept apart from configSchema.js (which needs
 * zod) so the web can read it too. The age is drawn against these lines; they
 * only colour the Backups section and send no alert.
 */
export const BACKUP_AGE_DEFAULT = Object.freeze({ warn: 36, crit: 72 });
export const BACKUP_AGE_LIMITS = Object.freeze({ min: 1, max: 720 });

const whole = (v) =>
  Number.isInteger(v) && v >= BACKUP_AGE_LIMITS.min && v <= BACKUP_AGE_LIMITS.max;

/** Whether `v` is a saved pair that can be used: whole hours, 1 to 720, `crit` over `warn`. */
export const isBackupAgeLines = (v) =>
  v !== null && typeof v === 'object' && whole(v.warn) && whole(v.crit) && v.crit > v.warn;

/** The lines to draw by: the saved pair, or the defaults when none is saved or it is no pair. */
export const backupAgeLines = (saved) =>
  isBackupAgeLines(saved) ? { warn: saved.warn, crit: saved.crit } : { ...BACKUP_AGE_DEFAULT };
