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

// For the stray check: the label as a whole token, so it is also found inside an
// expression such as `${{ inputs.runner || 'vm103' }}` or a matrix value, while
// `vm1030` or `vm103-x` are different labels. The deploy pin needs the exact label.
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

/** [{ id, runsOn, labels, pinned, matrix }] for each job in a workflow's YAML source. */
function jobsOf(source) {
  const jobs = yaml.load(source)?.jobs ?? {};
  return Object.entries(jobs).map(([id, job]) => {
    const runsOn = job?.['runs-on'];
    const labels = runnerLabels(runsOn);
    return { id, runsOn, labels, pinned: labels.some((l) => LABEL_RE.test(l)), matrix: job?.strategy?.matrix };
  });
}

/** Jobs in the deploy workflow without the exact vm103 label (an expression could
 *  resolve to any runner, so it is not a pin). */
function unpinnedDeployJobs(source) {
  const jobs = jobsOf(source);
  if (jobs.length === 0) return ['(no jobs)'];
  return jobs.filter((j) => !j.labels.includes(DEPLOY_LABEL)).map((j) => `${j.id}: runs-on=${JSON.stringify(j.runsOn)}`);
}

/** Jobs outside the deploy workflow that claim vm103, as `file: job`. */
function strayPinnedJobs(files) {
  return files
    .filter(({ file }) => file !== DEPLOY_WORKFLOW)
    .flatMap(({ file, source }) =>
      jobsOf(source).flatMap((j) => {
        // the label can also arrive through the matrix: runs-on: ${{ matrix.runner }}
        const matrix = JSON.stringify(j.matrix ?? {});
        const viaMatrix = LABEL_RE.test(matrix);
        if (!j.pinned && !viaMatrix) return [];
        return [`${file}: job "${j.id}" runs-on=${JSON.stringify(j.runsOn)}${viaMatrix ? ` matrix=${matrix}` : ''}`];
      }));
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

test('vm103 checker: a deploy job needs the exact label, not one inside an expression', () => {
  // the expression could resolve to any runner, so the job is not pinned
  const expr = "${{ inputs.runner || 'vm103' }}";
  assert.deepEqual(unpinnedDeployJobs(`jobs:\n  d:\n    runs-on: "${expr}"\n`), [`d: runs-on="${expr}"`]);
});

test('vm103 checker: a label supplied through the matrix is a stray pin', () => {
  const source = 'jobs:\n  t:\n    runs-on: ${{ matrix.r }}\n    strategy:\n      matrix:\n        r: [ubuntu-latest, vm103]\n';
  assert.deepEqual(strayPinnedJobs([{ file: '.github/workflows/m.yml', source }]),
    ['.github/workflows/m.yml: job "t" runs-on="${{ matrix.r }}" matrix={"r":["ubuntu-latest","vm103"]}']);
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
const CHECK_WORKFLOW = '.gitea/workflows/check.yml';

/** A shell script with its comments removed: a `#` that starts a word, outside quotes,
 *  to the end of the line (`${#arr[@]}` and `"a # b"` are kept). Line by line, so an
 *  unbalanced quote (a heredoc's "it's") only affects its own line. */
function stripShellComments(script) {
  return script.split('\n').map((line) => {
    let quote = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quote) {
        if (c === quote) quote = '';
        else if (c === '\\' && quote === '"') i++;
      } else if (c === '\\') i++;
      else if (c === '"' || c === "'") quote = c;
      else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
    }
    return line;
  }).join('\n');
}

/** What is missing from the secret-floor wiring in check.yml's source ([] = wired). */
function floorWiringProblems(source) {
  const doc = yaml.load(source); // throws (fails) on invalid YAML
  const runs = Object.values(doc?.jobs ?? {}).flatMap((job) => (job?.steps ?? []).map((s) => stripShellComments(String(s?.run ?? ''))));
  const problems = [];
  if (!runs.some((r) => r.includes('scripts/secret-scan.py'))) problems.push('no step runs scripts/secret-scan.py');
  const tracked = runs.find((r) => r.includes('git ls-files --error-unmatch'));
  if (!tracked) problems.push('no template-tracked step (git ls-files --error-unmatch)');
  for (const t of tracked ? ['env.example', 'fcm-service-account.json.example'] : []) {
    if (!tracked.includes(t)) problems.push(`template-tracked step does not assert ${t}`);
  }
  return problems;
}

test('stripShellComments: drops comments, keeps # inside quotes and ${#…}', () => {
  assert.equal(stripShellComments('echo skipped # python3 scripts/secret-scan.py'), 'echo skipped ');
  assert.equal(stripShellComments('  # note\necho "a # b" \'c # d\' ${#arr[@]} x#y'), '  \necho "a # b" \'c # d\' ${#arr[@]} x#y');
  assert.equal(stripShellComments('echo "q\\" # c" # gone'), 'echo "q\\" # c" ');
});

test('floor-wiring checker: a commented-out command does not count', () => {
  const wf = (scan) => `jobs:\n  check:\n    steps:\n      - run: |\n          ${scan}\n      - run: |\n          for f in env.example fcm-service-account.json.example; do\n            git ls-files --error-unmatch -- "$f"\n          done\n`;
  assert.deepEqual(floorWiringProblems(wf('python3 scripts/secret-scan.py')), []);
  assert.deepEqual(floorWiringProblems(wf('echo skipped # python3 scripts/secret-scan.py')),
    ['no step runs scripts/secret-scan.py']);
});

test('check.yml runs the secret scan and the template-tracked assertion', () => {
  const problems = floorWiringProblems(read(CHECK_WORKFLOW));
  assert.equal(problems.length, 0, `${CHECK_WORKFLOW}: ${problems.join('; ')}`);
});

// ── no tests outside npm test ───────────────────────────────────────────────
// `npm test` only collects *.test.{js,mjs,cjs}; a shell test would silently never run
// in CI (#212). Write repo checks as node:test files instead.
test('no *.test.sh files (npm test would never run them)', () => {
  const shellTests = execFileSync('git', ['ls-files', '--', '*.test.sh'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);
  assert.deepEqual(shellTests, [], `shell tests are not run by npm test; port them to node:test: ${shellTests.join(', ')}`);
});
