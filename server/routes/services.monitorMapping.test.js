// GET /api/services/monitor-mapping (#319): the last cycle's board read as what
// Settings offers for mapping monitors. Read-only; mounted under /api/services,
// so index.js's auth middleware gates it with the rest.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

process.env.LOG_LEVEL = 'silent';
const { servicesRoutes } = await import('./services.js');
const { setCache } = await import('../cache.js');

const app = express();
app.use(express.json());
app.use('/api/services', servicesRoutes);

test('before the first refresh there is nothing to suggest', async () => {
  const r = await request(app).get('/api/services/monitor-mapping');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { services: {}, monitorOnly: [] });
});

test('after a refresh each running container has an entry, keyed by its uid', async () => {
  setCache(
    'services',
    { nodes: { vm103: { services: [{ container: 'loki', source: 'container', monitored: false }] } } },
    { monitorOf: {} }
  );
  const r = await request(app).get('/api/services/monitor-mapping');
  assert.equal(r.status, 200);
  // No Kuma configured in the test: no monitor attached, none to suggest.
  assert.deepEqual(r.body.services['vm103:loki'], {
    attached: null,
    paused: false,
    suggested: null,
    why: null,
    candidates: [],
    held: {},
  });
});

test('#644: monitorOnly lists each monitor no container carries, by name, with its node and how it was placed', async () => {
  setCache(
    'services',
    { nodes: { vm101: { services: [] }, pi1: { services: [] } } },
    {
      monitorOf: {},
      monitorPlaced: {
        'pi1:cadvisor-pi1': { monitor: 'cadvisor-pi1', node: 'pi1', by: 'name' },
        'vm101:Backups': { monitor: 'Backups', node: 'vm101', by: 'first' },
      },
    }
  );
  const r = await request(app).get('/api/services/monitor-mapping');
  assert.deepEqual(r.body.monitorOnly, [
    { uid: 'vm101:Backups', id: null, monitor: 'Backups', node: 'vm101', by: 'first', status: 'unknown' },
    { uid: 'pi1:cadvisor-pi1', id: null, monitor: 'cadvisor-pi1', node: 'pi1', by: 'name', status: 'unknown' },
  ]);
});

test('it only reads: a write to it is refused', async () => {
  const r = await request(app).post('/api/services/monitor-mapping').send({});
  assert.equal(r.status, 404);
});
