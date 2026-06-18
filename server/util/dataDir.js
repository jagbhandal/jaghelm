// @ts-check
/**
 * Single source of truth for where runtime state lives.
 *
 * Overridable via JAGHELM_DATA_DIR so tests run against a temp dir and a
 * containerized deploy can relocate state — kept consistent across every store
 * (secrets, auth hash, services.yaml, cron history) so they never split apart.
 */
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const utilDir = dirname(fileURLToPath(import.meta.url)); // server/util
export const DATA_DIR = process.env.JAGHELM_DATA_DIR || join(utilDir, '..', '..', 'data');
