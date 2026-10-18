/**
 * Vulnerability digest dry run (`scripts/arcane-poll-once.js --vuln-digest`).
 * Runs the real digest twice over a throwaway state file and sends no push: pass 1 is
 * the silent baseline, pass 2 shows what would push against it (scan health, at least).
 * Then, per environment that baselined, the push it would get if every current finding
 * were new, to preview the format. Prints each environment's outcome, including a
 * refused read (no vulnerabilities:read) with what to grant. The API key is never
 * printed. Returns an exit code: 0 when at least one environment was read and none
 * failed with a read error, 1 otherwise (a refused read alone is not an error).
 */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createArcaneClient } from './client.js';
import { createVulnStateStore } from './vulnStateStore.js';
import { createVulnDigest, nextSlotMs } from './vulnDigest.js';
import { buildDigest } from './vulnDerive.js';
import { buildVulnDigestPush } from './format.js';

const READ = new Set(['baseline', 'digest', 'no-results']);
const HINT = 'grant vulnerabilities:read for this environment on the JagHelm key';

/** One environment's result, printable (no key set). */
function describe(r) {
  const out = { env: r.env, outcome: r.outcome };
  if (r.error) out.error = r.error;
  if (r.outcome === 'no-permission') out.hint = HINT;
  if (READ.has(r.outcome) && r.outcome !== 'no-results') {
    Object.assign(out, { findings: r.findings, kev: r.kev, stale: r.stale, failed: r.failed });
  }
  if (r.digest) out.digest = r.digest;
  return out;
}

export async function runVulnDigestOnce({ cfg, out, err }) {
  const client = createArcaneClient({ baseUrl: cfg.url, apiKey: cfg.apiKey, timeoutMs: 30_000 });
  const dir = mkdtempSync(join(tmpdir(), 'arcane-vuln-digest-once-'));
  const runs = [];
  const digest = createVulnDigest({
    client,
    stateStore: createVulnStateStore({ path: join(dir, 'arcane-vuln-state.json') }),
    recordRun: (r) => runs.push(r),
    dispatch: async (events) => {
      for (const e of events) out('  would push:', JSON.stringify(e));
    },
    pushStore: null,
    fcm: null,
    logger: {
      debug() {},
      info() {},
      warn: (...a) => err(JSON.stringify(a[1] ?? a[0])),
      error: (...a) => err(JSON.stringify(a[1] ?? a[0])),
    },
    day: cfg.vulnDay,
    hour: cfg.vulnHour,
  });

  try {
    let failed = false;
    let read = false;
    let baselined = [];
    for (const pass of [1, 2]) {
      out(`--- vulnerability digest, pass ${pass}${pass === 1 ? ' (baseline)' : ''} ---`);
      const { results } = await digest.runOnce();
      out(
        JSON.stringify({ environments: results.map(describe), cronRuns: runs.splice(0) }, null, 2)
      );
      for (const r of results) {
        if (r.outcome === 'error') failed = true;
        if (READ.has(r.outcome)) read = true;
      }
      if (pass === 1) baselined = results.filter((r) => r.outcome === 'baseline');
    }
    for (const r of baselined) {
      out(`--- preview: ${r.env} if every current finding were new ---`);
      const d = buildDigest({
        added: [...r.current.values()],
        fixed: [],
        kev: r.kev,
        prevKev: r.kev,
        health: { stale: r.stale, failed: r.failed },
      });
      out('  ', JSON.stringify(buildVulnDigestPush({ env: r.env, digest: d })));
    }
    const next = new Date(nextSlotMs(Date.now(), cfg.vulnDay, cfg.vulnHour)).toISOString();
    out(
      `next scheduled digest: ${next} (ARCANE_VULN_DIGEST_DAY ${cfg.vulnDay}, ARCANE_VULN_DIGEST_HOUR ${cfg.vulnHour} UTC)`
    );
    return failed || !read ? 1 : 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
