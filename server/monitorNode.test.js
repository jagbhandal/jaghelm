/**
 * Which node a monitor no container carries is shown on (#644): each step of
 * monitorNode.js on its own, then how they stack.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  candidatesOf,
  hostOf,
  inferMonitorNode,
  nodeByName,
  nodeBySetting,
  nodeByTarget,
  targetHostOf,
} from './monitorNode.js';

const entries = (o) => Object.entries(o).map(([k, cfg]) => [k, cfg, {}]);
const lab = candidatesOf(
  entries({
    vm101: { display_name: 'Staging', prometheus_node: 'vm101' },
    vm103: { display_name: 'Production', prometheus_node: 'vm103', address: ['192.168.68.11', 'prod.lan:9100'] },
    pi1: { display_name: 'Pi 1', address: 'http://192.168.68.13:9100/metrics' },
    pi2: { display_name: 'Pi 2', address: '192.168.68.14' },
  })
);

test('hostOf: a host only, never credentials, port, path or query', () => {
  assert.equal(hostOf('https://user:pw@Host.Example:8443/a?token=x#y'), 'host.example');
  assert.equal(hostOf('192.168.68.13:9100'), '192.168.68.13');
  assert.equal(hostOf('http://[fe80::1]:80/'), 'fe80::1');
  assert.equal(hostOf('pi1.'), 'pi1');
  for (const none of ['', 'null', 'https://', undefined, null, 5]) assert.equal(hostOf(none), null);
});

test('targetHostOf: monitor_hostname first, else the host of monitor_url ("null" is none)', () => {
  assert.equal(targetHostOf({ monitor_hostname: '192.168.68.13', monitor_url: 'https://x.example/' }), '192.168.68.13');
  assert.equal(targetHostOf({ monitor_hostname: 'null', monitor_url: 'http://u:p@192.168.68.14:8080/?k=v' }), '192.168.68.14');
  assert.equal(targetHostOf({ monitor_hostname: 'null', monitor_url: 'https://' }), null);
  assert.equal(targetHostOf({}), null);
});

test('step 1, the setting: a node on the board, the monitor name compared without case', () => {
  assert.equal(nodeBySetting({ 'cadvisor-pi1': 'pi2' }, 'cadvisor-pi1', lab), 'pi2');
  assert.equal(nodeBySetting({ 'Cadvisor-PI1': 'pi2' }, 'cadvisor-pi1', lab), 'pi2');
  assert.equal(nodeBySetting({ 'cadvisor-pi1': 'nowhere' }, 'cadvisor-pi1', lab), null, 'not a node on the board');
  assert.equal(nodeBySetting({ 'cadvisor-pi1': 5 }, 'cadvisor-pi1', lab), null);
  assert.equal(nodeBySetting({ other: 'pi2' }, 'cadvisor-pi1', lab), null);
  for (const junk of [null, undefined, 'pi2', ['pi2']]) assert.equal(nodeBySetting(junk, 'x', lab), null);
});

test('step 2, the target host: a node address, or its key as a host name, one node only', () => {
  assert.equal(nodeByTarget('192.168.68.13', lab), 'pi1', 'address given as a URL');
  assert.equal(nodeByTarget('192.168.68.14', lab), 'pi2');
  assert.equal(nodeByTarget('192.168.68.11', lab), 'vm103', 'one of a list');
  assert.equal(nodeByTarget('prod.lan', lab), 'vm103', 'address with a port');
  assert.equal(nodeByTarget('pi1', lab), 'pi1', 'the key as a host name');
  assert.equal(nodeByTarget('pi1.home.lan', lab), 'pi1', 'its first label');
  assert.equal(nodeByTarget('192.168.68.99', lab), null);
  assert.equal(nodeByTarget(null, lab), null);
});

test('step 2: two nodes with the host, or a host that is not a name, decide nothing', () => {
  const two = candidatesOf(entries({ a: { address: '10.0.0.1' }, b: { address: '10.0.0.1' }, c: {} }));
  assert.equal(nodeByTarget('10.0.0.1', two), null);
  assert.equal(nodeByTarget('10.0.0.1.example', candidatesOf(entries({ '10': {} }))), null, 'only a name matches by label');
});

test('step 3, the name: a key, prometheus_node or display name as a whole word', () => {
  assert.equal(nodeByName('cadvisor-pi1', lab), 'pi1');
  assert.equal(nodeByName('cAdvisor pi2', lab), 'pi2');
  assert.equal(nodeByName('Staging DNS', lab), 'vm101', 'display name');
  assert.equal(nodeByName('Production Backup', lab), 'vm103');
  assert.equal(nodeByName('Pi 1 NPM', lab), 'pi1', 'display name of two words');
});

test('step 3: vm101, vm-101, vm_101 and "vm 101" are one word', () => {
  const dashed = candidatesOf(entries({ 'vm-101': {}, 'vm-103': {} }));
  for (const name of ['cadvisor-vm101', 'cadvisor-vm-101', 'cadvisor_VM_101', 'cadvisor vm 101']) {
    assert.equal(nodeByName(name, dashed), 'vm-101', name);
    assert.equal(nodeByName(name, lab), 'vm101', name);
  }
});

test('step 3: whole words only, and ambiguous or empty answers decide nothing', () => {
  assert.equal(nodeByName('cadvisor-pi10', lab), null, 'pi1 is not in pi10');
  assert.equal(nodeByName('cadvisor-vm1010', lab), null);
  assert.equal(nodeByName('sharpie1', lab), null, 'not inside a longer word');
  assert.equal(nodeByName('pi1-and-pi2 link', lab), null, 'two nodes');
  assert.equal(nodeByName('cadvisor', lab), null, 'none');
  assert.equal(nodeByName('', lab), null);
  const dup = candidatesOf(entries({ a: { display_name: 'Lab' }, b: { display_name: 'lab' } }));
  assert.equal(nodeByName('Lab router', dup), null, 'one name on two nodes');
  const twoWords = candidatesOf(entries({ x: { prometheus_node: 'pi1' }, pi1: {} }));
  assert.equal(nodeByName('cadvisor-pi1', twoWords), null, 'pi1 is a word of two nodes');
  const tiny = candidatesOf(entries({ 1: {}, a: {} }));
  assert.equal(nodeByName('node 1 a', tiny), null, 'a digit or a letter names no node');
});

test('a node that matches by key and by display name is still one node', () => {
  assert.equal(nodeByName('pi1 pi1', candidatesOf(entries({ pi1: { display_name: 'PI1', prometheus_node: 'pi1' }, pi2: {} }))), 'pi1');
});

test('inferMonitorNode: the target host beats the name; nothing decides null', () => {
  assert.deepEqual(inferMonitorNode({ name: 'cadvisor-pi1', targetHost: '192.168.68.14' }, lab), { nodeKey: 'pi2', by: 'target' });
  assert.deepEqual(inferMonitorNode({ name: 'cadvisor-pi1', targetHost: '192.168.68.99' }, lab), { nodeKey: 'pi1', by: 'name' });
  assert.deepEqual(inferMonitorNode({ name: 'cadvisor-pi1' }, lab), { nodeKey: 'pi1', by: 'name' });
  assert.equal(inferMonitorNode({ name: 'cadvisor', targetHost: 'elsewhere' }, lab), null);
});

test('candidatesOf: sorted by key, so the answer does not depend on the order of the nodes', () => {
  const rev = candidatesOf(entries({ pi2: {}, pi1: {}, vm103: {} }));
  assert.deepEqual(rev.map((c) => c.key), ['pi1', 'pi2', 'vm103']);
  const a = candidatesOf(entries({ x: { address: '10.0.0.1' }, y: { address: '10.0.0.2' } }));
  const b = candidatesOf(entries({ y: { address: '10.0.0.2' }, x: { address: '10.0.0.1' } }));
  assert.deepEqual(a, b);
});
