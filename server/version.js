/**
 * Single source of truth for the app version — read from package.json so the
 * boot log, /api/health, and image labels can't drift (they previously
 * hardcoded "8.0.0-alpha.1" while package.json said 1.0.0).
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

let version = '0.0.0';
try {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  version = JSON.parse(readFileSync(pkgPath, 'utf8')).version || version;
} catch {
  /* keep fallback */
}

export const VERSION = version;
