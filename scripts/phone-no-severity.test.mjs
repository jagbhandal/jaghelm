/*
 * The phone screens judge no state (#325, spec §6, ADR 0006): every state,
 * word and reason they show is the status model's (/api/status), drawn
 * through src/phone/data/board.js. This fails if a severity of their own
 * comes back anywhere in src/phone/, tests aside:
 *
 *  - a reading compared with a line of its own, either way round: a round
 *    whole number from 50 (`>= 90`, `75 < t`, `> 98`), a fraction from 0.7 (`> 0.95`,
 *    `u >= .99`), or any number against a percentage, a usage, an uptime or
 *    a charge (`pct > 40`, `cpu * 100 >= 3`). The lines are the model's,
 *    served with each status (`thresholds`);
 *  - the derivation #325 deleted, by name (overallSeverity, nodeSeverity,
 *    deriveIncidents, CPU_HOT, …);
 *  - the old severities as values ('healthy', 'caution'): the
 *    screens hand the shared components the model's states (ok, warn, crit,
 *    unknown, maintenance).
 *
 * derive.test.js holds derive.js to its display helpers.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['src/phone'].map((dir) => resolve(ROOT, dir));

/** Every source file under `dir`, tests aside. */
function filesIn(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesIn(path);
    return /\.(js|jsx)$/.test(name) && !/\.test\.(js|jsx)$/.test(name) ? [path] : [];
  });
}

/** Every source file under src/phone/, tests aside. */
const sources = () => DIRS.flatMap(filesIn);

// A comparison: <, <=, > or >=, never => or a JSX tag.
const CMP = String.raw`(?:<=?|>=?)`;
// A line of the app's own: a round whole 50 to 95, or 96 to 99, or a
// fraction from 0.7. (Not any whole number: `b >= 64` is an address range.)
const LINE = String.raw`(?:(?:[5-9][05]|9[6-9])(?![\d.])|0?\.[7-9]\d*(?!\d))`;
// A reading that is a share of something.
const SHARE = String.raw`\b\w*(?:pct|percent|usage|uptime|charge|cpu|mem|disk|temp|load)\w*`;

const RULES = [
  {
    what: 'a reading compared with a line of its own',
    pattern: new RegExp(
      `(?<![=!<>])${CMP}\\s*${LINE}|(?<![\\w.])${LINE}\\s*${CMP}(?![=>])`
    ),
  },
  {
    what: 'a percentage, usage, uptime or charge compared with a number',
    pattern: new RegExp(
      `${SHARE}\\s*(?:\\*\\s*100\\s*)?\\)?\\s*${CMP}\\s*[\\d.]|[\\d.]\\s*${CMP}\\s*\\(?${SHARE}`,
      'i'
    ),
  },
  {
    what: 'the deleted derivation',
    pattern:
      /\b(?:overallSeverity|nodeSeverity|subsystemSeverity|deriveSubsystems|deriveIncidents|deriveHero|worstCaution|statusToSeverity|statusToShape|severityToShape|nodeSeverityWord|severityRank|maxSeverity|upsDegraded|cronDegraded|thirdMetric|CPU_HOT|TEMP_HOT|DISK_HOT)\b/,
  },
  { what: 'an old severity as a value', pattern: /['"](?:healthy|caution)['"]/ },
];

describe('no severity of the phone screens’ own (#325)', () => {
  it('finds the sources it scans', () => {
    const files = sources().map((f) => relative(ROOT, f));
    assert.ok(files.includes('src/phone/data/board.js'));
    assert.ok(files.includes('src/phone/views/Overview.jsx'));
  });

  for (const { what, pattern } of RULES) {
    it(`no source has ${what}`, () => {
      const found = sources().flatMap((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .map((line, i) => [line, i + 1])
          // Comments may name what was deleted and why.
          .filter(([line]) => !/^\s*(?:\/\/|\*|\/\*)/.test(line) && pattern.test(line))
          .map(([line, n]) => `${relative(ROOT, file)}:${n}: ${line.trim()}`)
      );
      assert.deepEqual(found, []);
    });
  }

  const [line, share, deleted, oldWord] = RULES.map((r) => r.pattern);

  it('the rules catch what they are for', () => {
    // A line of the app's own, whole or a fraction, either way round.
    for (const code of [
      'pct >= 90 ? red : amber',
      'temp > 75',
      'x<=55',
      'pct > 98',
      'u > 0.95',
      'u > 0.99 ? green : amber',
      'u >= .9',
      'value < 0.7',
      '0.95 < u',
      '90 <= pct',
    ]) {
      assert.ok(line.test(code), code);
    }
    // A share compared with any number.
    for (const code of [
      'pct > 40',
      'percent >= 5',
      'uptime24 < 1',
      'node.memPercent >= 12',
      'cpu * 100 > 3',
      '(usage) <= 0.5',
      'ups.charge < 20',
      '40 < pct',
    ]) {
      assert.ok(share.test(code), code);
    }
    // Not a severity: sizes, counts, arrows, tags and plain arithmetic.
    for (const code of [
      'width < 900',
      'if (a === 100 && b >= 64 && b <= 127) return true;',
      'px >= 14',
      'down > 0',
      'total === 0',
      'fraction > 0',
      '(r) => 90',
      '<span>{down} down</span>',
      'Math.round(ups.runtime / 60)',
      'Math.min(percent, 100)',
      'const step = 10 ** (2 - decimals);',
    ]) {
      assert.ok(!(line.test(code) || share.test(code)), code);
    }
    assert.ok(deleted.test('const sev = nodeSeverity(node);'));
    assert.ok(oldWord.test("severity: 'caution'"));
  });
});
