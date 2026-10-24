/**
 * Discovery carries a container's Compose project and image (#642), read from
 * cAdvisor's labels on the series. A cAdvisor without the labels (a Pi's) gives
 * a container with neither key.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { initDiscovery, getNodesData } = await import('./discovery.js');
initDiscovery('http://localhost:9998');
const realFetch = globalThis.fetch;

const answer = (samples) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  body: null,
  json: async () => ({
    data: { result: samples.map((s) => ({ ...s, metric: { node: 'vm-test', ...s.metric } })) },
  }),
});

const EVAL = 1700000000;
const labelled = {
  name: 'immich_redis',
  image: 'docker.io/redis:6.2-alpine',
  container_label_com_docker_compose_project: ' Immich ',
};

function respond(url) {
  const q = decodeURIComponent(url);
  if (new URL(String(url)).pathname === '/api/v1/targets') {
    return {
      ...answer([]),
      json: async () => ({ status: 'success', data: { activeTargets: [], droppedTargets: [] } }),
    };
  }
  if (q.includes('container_last_seen')) {
    return answer([
      { metric: labelled, value: [EVAL, String(EVAL - 5)] },
      { metric: { name: 'gateway-npm' }, value: [EVAL, String(EVAL - 5)] },
    ]);
  }
  // A later series for the same container, with no labels, must not blank them.
  if (q.includes('container_cpu_usage_seconds_total')) {
    return answer([{ metric: { name: 'immich_redis' }, value: [EVAL, '1'] }]);
  }
  return answer([]);
}

test('discovery: a container carries its Compose project (lower case) and image', async () => {
  globalThis.fetch = async (url) => respond(url);
  try {
    const { containers } = (await getNodesData(['vm-test'])).get('vm-test');
    const redis = containers.find((c) => c.container === 'immich_redis');
    assert.equal(redis.project, 'immich');
    assert.equal(redis.image, 'docker.io/redis:6.2-alpine');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('discovery: a container with no project label has no project or image key', async () => {
  globalThis.fetch = async (url) => respond(url);
  try {
    const { containers } = (await getNodesData(['vm-test'])).get('vm-test');
    const npm = containers.find((c) => c.container === 'gateway-npm');
    assert.equal(Object.hasOwn(npm, 'project'), false);
    assert.equal(Object.hasOwn(npm, 'image'), false);
  } finally {
    globalThis.fetch = realFetch;
  }
});
