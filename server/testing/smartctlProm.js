/**
 * Test-only: a Prometheus for drives.js. It parses smartctl_exporter's text
 * output (server/fixtures/smartctl-*.metrics, real samples with the serial
 * numbers redacted) and answers each of driveQueries' instant queries as
 * Prometheus would, aggregations included (`max by (...)` keeps only the
 * labels it names). It does not evaluate PromQL: a query it doesn't know
 * is a test failure, so a changed query can't pass unnoticed.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { driveQueries } from '../drives.js';

const fixture = (name) =>
  readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8');

/** A fixture's text. */
export const smartctlText = fixture;

/** The samples of exposition text: `[{ name, labels, value }]`; comments skipped. */
export function parseExposition(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+(\S+)$/.exec(line);
    if (!m) continue;
    const labels = {};
    for (const l of (m[2] ?? '').matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g)) labels[l[1]] = l[2];
    out.push({ name: m[1], labels, value: Number(m[3]) });
  }
  return out;
}

const keep = (labels, names) => Object.fromEntries(names.filter((n) => n in labels).map((n) => [n, labels[n]]));
const sample = (metric, value) => ({ metric, value: [1_800_000_000, String(value)] });
const VALUES = /^smartctl_device_(smart_status|critical_warning|available_spare|available_spare_threshold|media_errors|percentage_used|power_on_seconds|rotation_rate|smartctl_exit_status)$/;

/**
 * @param {{ nodes: Record<string, { text: string, up?: number }>, growth?: Record<string, Record<string, number>>, matcher?: string }} opts
 *   nodes: the exporter output of each node label; growth: `"<node>/<device>"`
 *   -> `{ 5, 197, 198, media }` the window's growth
 * @returns {{ query: (q: string) => Promise<any[]>, asked: string[] }}
 */
export function smartctlProm({ nodes, growth = {}, matcher = 'node=~"nas|pve"' }) {
  const queries = driveQueries(matcher);
  const byText = new Map(Object.entries(queries).map(([name, text]) => [text, name]));
  const samples = Object.entries(nodes).flatMap(([node, { text }]) =>
    parseExposition(text).map((s) => ({ ...s, labels: { ...s.labels, node } }))
  );
  const asked = [];
  const answer = {
    probe: () => {
      const n = samples.filter((s) => s.name === 'smartctl_devices').length;
      return n ? [sample({}, n)] : [];
    },
    info: () =>
      samples.filter((s) => s.name === 'smartctl_device').map((s) => sample(keep(s.labels, ['node', 'device', 'model_name', 'protocol']), s.value)),
    values: () =>
      samples
        .filter((s) => VALUES.test(s.name))
        .map((s) => sample({ __name__: s.name, ...keep(s.labels, ['node', 'device']) }, s.value)),
    temperature: () =>
      samples
        .filter((s) => s.name === 'smartctl_device_temperature' && s.labels.temperature_type === 'current')
        .map((s) => sample(keep(s.labels, ['node', 'device']), s.value)),
    sectors: () =>
      samples
        .filter(
          (s) =>
            s.name === 'smartctl_device_attribute' &&
            ['5', '197', '198'].includes(s.labels.attribute_id) &&
            s.labels.attribute_value_type === 'raw'
        )
        .map((s) => sample(keep(s.labels, ['node', 'device', 'attribute_id']), s.value)),
    devices: () => samples.filter((s) => s.name === 'smartctl_devices').map((s) => sample(keep(s.labels, ['node']), s.value)),
    up: () => Object.entries(nodes).map(([node, { up = 1 }]) => sample({ node }, up)),
  };
  const grown = (field) => () =>
    Object.entries(growth)
      .filter(([, g]) => field in g)
      .map(([id, g]) => {
        const [node, device] = id.split('/');
        return sample({ node, device }, g[field]);
      });
  answer.mediaGrowth = grown('media');
  for (const id of [5, 197, 198]) answer[`growth${id}`] = grown(String(id));

  return {
    asked,
    async query(q) {
      const name = byText.get(q);
      if (!name) throw new Error(`a query drives.js does not make: ${q}`);
      asked.push(name);
      return answer[name]();
    },
  };
}
