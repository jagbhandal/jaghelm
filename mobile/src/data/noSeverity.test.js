/*
 * The Android app judges no state (#325, spec §6, ADR 0006): every state,
 * word and reason it shows is the status model's (/api/status), drawn
 * through data/board.js. This fails if a severity of the app's own comes back
 * anywhere in mobile/src/ (tests aside):
 *
 *  - a reading compared with a line of its own (`>= 90`, `< 75`): the lines
 *    are the model's, served with each status (`thresholds`);
 *  - the derivation #325 deleted, by name (overallSeverity, nodeSeverity,
 *    deriveIncidents, CPU_HOT, …);
 *  - the Android look's old severities as values ('healthy', 'caution'): the
 *    screens hand the shared components the model's states (ok, warn, crit,
 *    unknown, maintenance).
 *
 * derive.test.js holds derive.js to its display helpers.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// (path.resolve, not `new URL(rel, import.meta.url)`: Vite rewrites that.)
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every source file under mobile/src/, tests aside. */
function sources(dir = SRC) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(js|jsx)$/.test(name) && !/\.test\.(js|jsx)$/.test(name) ? [path] : [];
  });
}

const RULES = [
  {
    what: 'a reading compared with a line of the app’s own',
    pattern: /(?:>=?|<=?)\s*(?:70|75|80|85|90|95)(?![\d.])/,
  },
  {
    what: 'the deleted derivation',
    pattern:
      /\b(?:overallSeverity|nodeSeverity|subsystemSeverity|deriveSubsystems|deriveIncidents|deriveHero|worstCaution|statusToSeverity|statusToShape|severityToShape|nodeSeverityWord|severityRank|maxSeverity|upsDegraded|cronDegraded|thirdMetric|CPU_HOT|TEMP_HOT|DISK_HOT)\b/,
  },
  { what: 'an old Android severity as a value', pattern: /['"](?:healthy|caution)['"]/ },
];

describe('no severity of the app’s own (#325)', () => {
  it('finds the sources it scans', () => {
    const files = sources().map((f) => relative(SRC, f));
    expect(files).toContain('data/board.js');
    expect(files).toContain('components/UsageBar.jsx');
  });

  for (const { what, pattern } of RULES) {
    it(`no source has ${what}`, () => {
      const found = sources().flatMap((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .map((line, i) => [line, i + 1])
          // Comments may name what was deleted and why.
          .filter(([line]) => !/^\s*(?:\/\/|\*|\/\*)/.test(line) && pattern.test(line))
          .map(([line, n]) => `${relative(SRC, file)}:${n}: ${line.trim()}`)
      );
      expect(found).toEqual([]);
    });
  }

  it('the rules catch what they are for', () => {
    expect(RULES[0].pattern.test('pct >= 90 ? red : amber')).toBe(true);
    expect(RULES[0].pattern.test('temp > 75')).toBe(true);
    expect(RULES[0].pattern.test('u > 0.95')).toBe(false);
    expect(RULES[0].pattern.test('width < 900')).toBe(false);
    expect(RULES[1].pattern.test('const sev = nodeSeverity(node);')).toBe(true);
    expect(RULES[2].pattern.test("severity: 'caution'")).toBe(true);
  });
});
