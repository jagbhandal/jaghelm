import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NOT_JOB, isJobContainer, IGNORED_NAME_PREFIXES } from './helperContainers.js';
import {
  DOCKER_ADJECTIVES,
  DOCKER_SURNAMES,
  isDockerRandomName,
} from './dockerRandomNames.js';

// Compile the NOT_JOB selector the way Prometheus reads it: undo the PromQL
// string escaping, then anchor the regex (Prometheus anchors every matcher).
const selectorRegex = () => {
  const m = NOT_JOB.match(/^name!~"(.*)"$/);
  assert.ok(m, 'NOT_JOB is a name!~"..." matcher');
  return new RegExp(`^(?:${m[1].replace(/\\\\/g, '\\')})$`);
};

test('Docker auto-generated names are ignored', () => {
  for (const n of ['quirky_sammet', 'happy_bohr', 'elastic_edison']) {
    assert.equal(isDockerRandomName(n), true, n);
    assert.equal(isJobContainer(n), true, n);
    assert.equal(selectorRegex().test(n), true, n);
  }
});

test('real services with underscores are not ignored', () => {
  for (const n of ['node_exporter', 'foo_bar', 'postgres_exporter', 'quirky', 'sammet']) {
    assert.equal(isDockerRandomName(n), false, n);
    assert.equal(isJobContainer(n), false, n);
    assert.equal(selectorRegex().test(n), false, n);
  }
});

test('near-misses of a generated name are not ignored', () => {
  for (const n of ['quirky_sammet2', 'my-quirky_sammet', 'sammet_quirky', 'quirky_sammet_x', 'Quirky_Sammet', '_sammet', 'quirky_', '']) {
    assert.equal(isDockerRandomName(n), false, n);
    assert.equal(isJobContainer(n), false, n);
    assert.equal(selectorRegex().test(n), false, n);
  }
  assert.equal(isDockerRandomName(undefined), false);
  assert.equal(isJobContainer(null), false);
});

test('boring_wozniak is never generated, so it is not ignored', () => {
  assert.equal(isDockerRandomName('boring_wozniak'), false);
  assert.equal(isJobContainer('boring_wozniak'), false);
  assert.equal(selectorRegex().test('boring_wozniak'), false);
  assert.equal(isDockerRandomName('boring_bohr'), true);
  assert.equal(selectorRegex().test('boring_bohr'), true);
});

test('the PromQL selector agrees with the predicate', () => {
  const re = selectorRegex();
  const adjs = [...DOCKER_ADJECTIVES];
  const surs = [...DOCKER_SURNAMES];
  // Every adjective and surname at least once, plus a spread of pairs, plus the reversed pairs.
  const n = Math.max(adjs.length, surs.length);
  for (let i = 0; i < n; i++) {
    const a = adjs[i % adjs.length];
    const s = surs[(i * 7) % surs.length];
    for (const name of [`${a}_${s}`, `${s}_${a}`, `${a}_${s}1`, `x${a}_${s}`]) {
      assert.equal(re.test(name), isDockerRandomName(name), name);
    }
  }
  for (const name of ['boring_wozniak', 'node_exporter', 'GITEA-ACTIONS-TASK-1-JOB-x', 'handbook-build-42', 'handbook-build-', 'handbook']) {
    assert.equal(re.test(name), isJobContainer(name), name);
  }
});

test('prefix behaviour is unchanged', () => {
  const re = selectorRegex();
  for (const p of IGNORED_NAME_PREFIXES) {
    assert.equal(isJobContainer(`${p}123`), true, p);
    assert.equal(re.test(`${p}123`), true, p);
    assert.equal(isJobContainer(p), false, 'prefix alone is not a throwaway');
    assert.equal(re.test(p), false);
  }
  assert.equal(isJobContainer('handbook'), false);
  assert.equal(isJobContainer('jaghelm'), false);
});
