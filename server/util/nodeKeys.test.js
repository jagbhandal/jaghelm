import test from 'node:test';
import assert from 'node:assert/strict';
import { colonNodeKeys, nodeKeyFor } from './nodeKeys.js';
import { generateDefaultConfig } from '../config.js';

test('a node label is its own key; an instance label loses its port and any colon or space', () => {
  assert.equal(nodeKeyFor('vm103'), 'vm103');
  assert.equal(nodeKeyFor('pi9:9100'), 'pi9');
  assert.equal(nodeKeyFor('[fe80::1]:9100'), '[fe801]');
  assert.equal(nodeKeyFor(':9100'), 'node');
  assert.equal(nodeKeyFor('my host'), 'myhost');
});

test('a taken key is suffixed -2, -3, deterministically', () => {
  assert.equal(nodeKeyFor('pi9:9100', new Set(['pi9'])), 'pi9-2');
  assert.equal(nodeKeyFor('pi9:9100', new Set(['pi9', 'pi9-2'])), 'pi9-3');
});

test('a first boot keys discovered instance labels by host and keeps the label as prometheus_node', () => {
  const { nodes } = generateDefaultConfig(['a:9100', 'a:9101', 'b']);
  assert.deepEqual(Object.keys(nodes), ['a', 'a-2', 'b']);
  assert.equal(nodes['a-2'].prometheus_node, 'a:9101');
});

test('colonNodeKeys lists the keys with a colon, and nothing for a non-mapping', () => {
  assert.deepEqual(colonNodeKeys({ 'a:1': {}, b: {} }), ['a:1']);
  assert.deepEqual(colonNodeKeys([]), []);
  assert.deepEqual(colonNodeKeys(undefined), []);
});
