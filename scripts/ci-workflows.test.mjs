// Guards on the CI workflow files themselves. Plain node:test so `npm test` runs them
// in both CI systems (#212: the shell versions these replace only ran locally).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

// ── vm103 runner label ──────────────────────────────────────────────────────
// Every job in deploy.yml SSHes to vm-103, so each must carry the vm103 runner label
// and never land on a runner that is fenced from the LAN (#210). The reverse also
// holds: no other workflow may claim vm103, so the deploy host only runs deploys.
const DEPLOY_LABEL = 'vm103';
const DEPLOY_WORKFLOW = '.gitea/workflows/deploy.yml';
const WORKFLOW_DIRS = ['.gitea/workflows', '.github/workflows'];

// The label as a whole token, so it is also found inside an expression such as
// `${{ inputs.runner || 'vm103' }}` but `vm1030` or `vm103-x` are different labels.
const LABEL_RE = new RegExp(`(^|[^\\w-])${DEPLOY_LABEL}([^\\w-]|$)`);

/** `runs-on` as a label list: a string, a list, or GitHub's `{ group, labels }` form. */
function runnerLabels(runsOn) {
  if (runsOn == null) return []; // a reusable-workflow call (`uses:`) has no runs-on
  if (typeof runsOn === 'string') return [runsOn];
  if (Array.isArray(runsOn)) return runsOn.map(String);
  if (typeof runsOn === 'object') {
    const { group, labels } = runsOn;
    return [...(group == null ? [] : [String(group)]), ...runnerLabels(labels)];
  }
  return [String(runsOn)];
}

/** [{ id, runsOn, pinned }] for each job in a workflow's YAML source. */
function jobsOf(source) {
  const jobs = yaml.load(source)?.jobs ?? {};
  return Object.entries(jobs).map(([id, job]) => {
    const runsOn = job?.['runs-on'];
    return { id, runsOn, pinned: runnerLabels(runsOn).some((l) => LABEL_RE.test(l)) };
  });
}

/** Jobs in the deploy workflow that are NOT pinned to vm103. */
function unpinnedDeployJobs(source) {
  const jobs = jobsOf(source);
  if (jobs.length === 0) return ['(no jobs)'];
  return jobs.filter((j) => !j.pinned).map((j) => `${j.id}: runs-on=${JSON.stringify(j.runsOn)}`);
}

/** Jobs outside the deploy workflow that ARE pinned to vm103, as `file: job`. */
function strayPinnedJobs(files) {
  return files
    .filter(({ file }) => file !== DEPLOY_WORKFLOW)
    .flatMap(({ file, source }) =>
      jobsOf(source)
        .filter((j) => j.pinned)
        .map((j) => `${file}: job "${j.id}" runs-on=${JSON.stringify(j.runsOn)}`));
}

function repoWorkflows() {
  return WORKFLOW_DIRS.filter((dir) => existsSync(path.join(ROOT, dir))).flatMap((dir) =>
    readdirSync(path.join(ROOT, dir))
      .filter((name) => /\.ya?ml$/.test(name))
      .map((name) => {
        const file = `${dir}/${name}`;
        return { file, source: read(file) };
      }));
}

test('vm103 checker: finds the label in every runs-on form, ignores comments and look-alikes', () => {
  const wf = (runsOn) => `jobs:\n  j:\n    runs-on: ${runsOn}\n    steps: [{ run: 'true' }]\n`;
  assert.equal(jobsOf(wf('vm103'))[0].pinned, true, 'string');
  assert.equal(jobsOf(wf('[self-hosted, vm103]'))[0].pinned, true, 'flow list');
  assert.equal(jobsOf('jobs:\n  j:\n    runs-on:\n      - self-hosted\n      - vm103\n')[0].pinned, true, 'block list');
  assert.equal(jobsOf(wf('{ group: ci, labels: [vm103] }'))[0].pinned, true, 'group/labels object');
  assert.equal(jobsOf(wf('{ group: ci, labels: vm103 }'))[0].pinned, true, 'labels as a string');
  assert.equal(jobsOf(wf(`"\${{ inputs.runner || 'vm103' }}"`))[0].pinned, true, 'inside an expression');
  assert.equal(jobsOf(wf('self-hosted # moved off vm103'))[0].pinned, false, 'YAML comment');
  assert.equal(jobsOf(wf('[self-hosted, vm1030, vm103-x]'))[0].pinned, false, 'look-alike labels');
  assert.equal(jobsOf('jobs:\n  j:\n    uses: ./.github/workflows/x.yml\n')[0].pinned, false, 'reusable call');
});

test('vm103 checker: flags an unpinned deploy job and a stray pin, naming the file', () => {
  assert.deepEqual(unpinnedDeployJobs('jobs:\n  a:\n    runs-on: [self-hosted, vm103]\n  b:\n    runs-on: self-hosted\n'),
    ['b: runs-on="self-hosted"']);
  assert.deepEqual(unpinnedDeployJobs('jobs: {}\n'), ['(no jobs)']);
  const stray = strayPinnedJobs([
    { file: DEPLOY_WORKFLOW, source: 'jobs:\n  deploy:\n    runs-on: [self-hosted, vm103]\n' },
    { file: '.gitea/workflows/check.yml', source: 'jobs:\n  check:\n    runs-on: [self-hosted, vm103]\n' },
    { file: '.github/workflows/x.yaml', source: 'jobs:\n  t:\n    runs-on: ubuntu-latest\n' },
  ]);
  assert.deepEqual(stray, ['.gitea/workflows/check.yml: job "check" runs-on=["self-hosted","vm103"]']);
});

test(`every job in ${DEPLOY_WORKFLOW} is pinned to the ${DEPLOY_LABEL} runner`, () => {
  const unpinned = unpinnedDeployJobs(read(DEPLOY_WORKFLOW));
  assert.equal(unpinned.length, 0, `${DEPLOY_WORKFLOW}: job(s) not pinned to ${DEPLOY_LABEL}:\n  ${unpinned.join('\n  ')}`);
});

test(`no workflow other than ${DEPLOY_WORKFLOW} uses the ${DEPLOY_LABEL} runner`, () => {
  const files = repoWorkflows();
  assert.ok(files.some(({ file }) => file === DEPLOY_WORKFLOW), `${DEPLOY_WORKFLOW} not found`);
  const stray = strayPinnedJobs(files);
  assert.equal(stray.length, 0,
    `${DEPLOY_LABEL} is reserved for ${DEPLOY_WORKFLOW}, but it is also used by:\n  ${stray.join('\n  ')}`);
});

// ── check.yml wires the secret floor ────────────────────────────────────────
// The scanner and template-tracked assertions must stay wired as steps of the per-PR
// check (Phase 0 secret floor). Matched against step `run:` scripts, not comments.
test('check.yml runs the secret scan and the template-tracked assertion', () => {
  const wf = '.gitea/workflows/check.yml';
  const doc = yaml.load(read(wf)); // throws (fails) on invalid YAML
  const runs = Object.values(doc?.jobs ?? {}).flatMap((job) => (job?.steps ?? []).map((s) => String(s?.run ?? '')));
  assert.ok(runs.some((r) => r.includes('scripts/secret-scan.py')), `${wf}: no step runs scripts/secret-scan.py`);
  const tracked = runs.find((r) => r.includes('git ls-files --error-unmatch'));
  assert.ok(tracked, `${wf}: no template-tracked step (git ls-files --error-unmatch)`);
  for (const t of ['env.example', 'fcm-service-account.json.example']) {
    assert.ok(tracked.includes(t), `${wf}: template-tracked step does not assert ${t}`);
  }
});

// ── no tests outside npm test ───────────────────────────────────────────────
// `npm test` only collects *.test.{js,mjs,cjs}; a shell test would silently never run
// in CI (#212). Write repo checks as node:test files instead.
test('no *.test.sh files (npm test would never run them)', () => {
  const shellTests = execFileSync('git', ['ls-files', '--', '*.test.sh'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);
  assert.deepEqual(shellTests, [], `shell tests are not run by npm test; port them to node:test: ${shellTests.join(', ')}`);
});
