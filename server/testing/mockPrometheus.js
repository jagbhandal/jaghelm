/**
 * A Prometheus stand-in for tests (#234). It evaluates the part of PromQL that
 * JagHelm's node queries use, the per-node ones it used to send and the batched
 * ones it sends now, against a fixed list of series, and records every instant
 * query it answers so a test can count them.
 *
 * A series is { labels, value, rate?, quiet? }: `labels` includes `__name__`,
 * `value` is the instant value, and `rate` is what rate() or irate() over a
 * range gives for it (a counter's per-second increase). rate() skips a series
 * without one. A `quiet` series was scraped within any range asked but has no
 * sample now (its exporter has gone away): only last_over_time() finds it.
 *
 * Supported: selectors with =, !=, =~ and !~ (regexes anchored, as Prometheus
 * does; strings in "…" with only \\ and \" escapes, which Prometheus also
 * accepts), answering their series sorted by label set as Prometheus does, so
 * code that keeps the first or the last series reads what it would live;
 * rate(sel[d]) and irate(sel[d]); last_over_time(sel[d]), which keeps the
 * name as the homelab's Prometheus 3.15 does; sum, max, min, avg and count,
 * each with an optional `by (…)` before or after its argument; numbers; - + * /
 * between scalars and vectors (vector with vector matched one to one on every
 * label but the name, which arithmetic drops); `or` (which matches label sets
 * without the name, as Prometheus does). Anything else is a parse error,
 * answered as Prometheus would, with HTTP 400.
 */
import { HELPER_LABEL } from '../util/helperContainers.js';

export const EVAL_TS = 1_700_000_000;

// ── PromQL subset ───────────────────────────────────────────────────────

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i += 1;
    } else if (ch === '"') {
      let j = i + 1;
      let out = '';
      while (src[j] !== '"') {
        if (j >= src.length) throw new Error('unterminated string');
        if (src[j] === '\\') {
          if (src[j + 1] !== '\\' && src[j + 1] !== '"') throw new Error(`unknown escape sequence \\${src[j + 1]}`);
          out += src[j + 1];
          j += 2;
        } else {
          out += src[j];
          j += 1;
        }
      }
      tokens.push({ t: 'str', v: out });
      i = j + 1;
    } else if (ch === '[') {
      const j = src.indexOf(']', i);
      tokens.push({ t: 'range', v: src.slice(i + 1, j) });
      i = j + 1;
    } else if (['!=', '=~', '!~'].includes(src.slice(i, i + 2))) {
      tokens.push({ t: 'op', v: src.slice(i, i + 2) });
      i += 2;
    } else if ('{}(),=-+*/'.includes(ch)) {
      tokens.push({ t: 'op', v: ch });
      i += 1;
    } else {
      const rest = src.slice(i);
      const num = /^\d+(?:\.\d+)?/.exec(rest);
      const id = /^[A-Za-z_:][A-Za-z0-9_:]*/.exec(rest);
      if (num) tokens.push({ t: 'num', v: Number(num[0]) });
      else if (id) tokens.push({ t: 'id', v: id[0] });
      else throw new Error(`unexpected ${JSON.stringify(rest.slice(0, 20))}`);
      i += (num || id)[0].length;
    }
  }
  return tokens;
}

const withoutName = (labels) => {
  const rest = { ...labels };
  delete rest.__name__;
  return rest;
};
const byteOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sortedPairs = (labels) => Object.entries(labels).sort(([a], [b]) => byteOrder(a, b));
const labelKey = (labels) => JSON.stringify(sortedPairs(labels));

/**
 * Prometheus' order of label sets (labels.Compare): pair by pair in label-name
 * order, by name and then by value, a set that runs out first sorting first.
 * A selector answers its series in this order.
 */
function compareLabels(a, b) {
  const x = sortedPairs(a);
  const y = sortedPairs(b);
  for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
    const d = byteOrder(x[i][0], y[i][0]) || byteOrder(x[i][1], y[i][1]);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

const ARITHMETIC = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => a / b,
};

function binary(op, a, b) {
  const f = ARITHMETIC[op];
  if ('scalar' in a && 'scalar' in b) return { scalar: f(a.scalar, b.scalar) };
  if ('scalar' in a) return { vector: b.vector.map((s) => ({ labels: withoutName(s.labels), value: f(a.scalar, s.value) })) };
  if ('scalar' in b) return { vector: a.vector.map((s) => ({ labels: withoutName(s.labels), value: f(s.value, b.scalar) })) };
  const right = new Map(b.vector.map((s) => [labelKey(withoutName(s.labels)), s]));
  const vector = [];
  for (const s of a.vector) {
    const other = right.get(labelKey(withoutName(s.labels)));
    if (other) vector.push({ labels: withoutName(s.labels), value: f(s.value, other.value) });
  }
  return { vector };
}

function or(a, b) {
  const left = new Set(a.vector.map((s) => labelKey(withoutName(s.labels))));
  return { vector: [...a.vector, ...b.vector.filter((s) => !left.has(labelKey(withoutName(s.labels))))] };
}

const AGGREGATE = {
  sum: (v) => v.reduce((x, y) => x + y, 0),
  max: (v) => Math.max(...v),
  min: (v) => Math.min(...v),
  avg: (v) => v.reduce((x, y) => x + y, 0) / v.length,
  count: (v) => v.length,
};

function aggregate(fn, by, vector) {
  const groups = new Map();
  for (const s of vector) {
    const labels = {};
    for (const l of by) if (s.labels[l]) labels[l] = s.labels[l];
    const key = labelKey(labels);
    if (!groups.has(key)) groups.set(key, { labels, values: [] });
    groups.get(key).values.push(s.value);
  }
  return { vector: [...groups.values()].map((g) => ({ labels: g.labels, value: AGGREGATE[fn](g.values) })) };
}

function matches(value, { op, v }) {
  if (op === '=') return value === v;
  if (op === '!=') return value !== v;
  const re = new RegExp(`^(?:${v})$`);
  return op === '=~' ? re.test(value) : !re.test(value);
}

class Parser {
  constructor(src, series) {
    this.tokens = tokenize(src);
    this.pos = 0;
    this.series = series;
  }

  peek() {
    return this.tokens[this.pos];
  }

  next() {
    const tok = this.tokens[this.pos];
    if (!tok) throw new Error('unexpected end of query');
    this.pos += 1;
    return tok;
  }

  is(t, v) {
    const tok = this.peek();
    return tok?.t === t && tok.v === v;
  }

  expect(t, v) {
    const tok = this.next();
    if (tok.t !== t || (v !== undefined && tok.v !== v)) throw new Error(`expected ${v ?? t}, got ${tok.v}`);
    return tok.v;
  }

  parse() {
    const result = this.expr();
    if (this.pos !== this.tokens.length) throw new Error(`unexpected ${this.peek().v}`);
    if (!result.vector) throw new Error('the mock answers vectors only');
    return result.vector;
  }

  expr() {
    let left = this.additive();
    while (this.is('id', 'or')) {
      this.next();
      left = or(left, this.additive());
    }
    return left;
  }

  additive() {
    let left = this.multiplicative();
    while (this.is('op', '-') || this.is('op', '+')) {
      const op = this.next().v;
      left = binary(op, left, this.multiplicative());
    }
    return left;
  }

  multiplicative() {
    let left = this.unary();
    while (this.is('op', '*') || this.is('op', '/')) {
      const op = this.next().v;
      left = binary(op, left, this.unary());
    }
    return left;
  }

  unary() {
    const tok = this.peek();
    if (tok?.t === 'num') return { scalar: this.next().v };
    if (this.is('op', '(')) {
      this.next();
      const inner = this.expr();
      this.expect('op', ')');
      return inner;
    }
    if (this.is('op', '{')) return this.selector(null);
    const name = this.expect('id');
    if (AGGREGATE[name]) return this.aggregation(name);
    if (name === 'rate' || name === 'irate') {
      this.expect('op', '(');
      const sel = this.selector(this.expect('id'));
      this.expect('range');
      this.expect('op', ')');
      return {
        vector: sel.vector.filter((s) => s.rate !== undefined).map((s) => ({ labels: withoutName(s.labels), value: s.rate })),
      };
    }
    if (name === 'last_over_time') {
      this.expect('op', '(');
      const sel = this.selector(this.expect('id'), { withQuiet: true });
      this.expect('range');
      this.expect('op', ')');
      return sel;
    }
    return this.selector(name);
  }

  selector(name, { withQuiet = false } = {}) {
    const matchers = name ? [{ label: '__name__', op: '=', v: name }] : [];
    if (this.is('op', '{')) {
      this.next();
      while (!this.is('op', '}')) {
        const label = this.expect('id');
        const op = this.expect('op');
        if (!['=', '!=', '=~', '!~'].includes(op)) throw new Error(`bad matcher operator ${op}`);
        matchers.push({ label, op, v: this.expect('str') });
        if (this.is('op', ',')) this.next();
      }
      this.next();
    }
    if (matchers.length === 0) throw new Error('a selector needs a matcher');
    return {
      vector: this.series
        .filter((s) => (withQuiet || !s.quiet) && matchers.every((m) => matches(s.labels[m.label] ?? '', m)))
        .sort((a, b) => compareLabels(a.labels, b.labels))
        .map((s) => ({ labels: s.labels, value: s.value, rate: s.rate })),
    };
  }

  aggregation(fn) {
    const by = [];
    const readBy = () => {
      if (!this.is('id', 'by')) return;
      this.next();
      this.expect('op', '(');
      while (!this.is('op', ')')) {
        by.push(this.expect('id'));
        if (this.is('op', ',')) this.next();
      }
      this.next();
    };
    readBy();
    this.expect('op', '(');
    const inner = this.expr();
    this.expect('op', ')');
    readBy();
    return aggregate(fn, by, inner.vector);
  }
}

/** Evaluate `query` over `series`, as a Prometheus instant query's `result`. */
export function evaluate(query, series) {
  return new Parser(query, series).parse().map((s) => ({ metric: { ...s.labels }, value: [EVAL_TS, String(s.value)] }));
}

// ── The mock server ─────────────────────────────────────────────────────

const answer = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  body: null,
  json: async () => body,
});

/**
 * The scrape targets behind `series`' `up` series, as /api/v1/targets lists
 * its active targets (#470): one per `up` series, its labels without the
 * name. Scraped (`scraped`, the default), each has a last scrape and is
 * healthy when its `up` is above 0; not scraped yet (a Prometheus that has
 * just started), each is "unknown", with Prometheus's zero time.
 */
export function targetsOf(series, { scraped = true } = {}) {
  return series
    .filter((s) => s.labels.__name__ === 'up')
    .map(({ labels: { __name__, ...labels }, value }) => ({
      discoveredLabels: { __address__: labels.instance },
      labels,
      scrapePool: labels.job,
      scrapeUrl: `http://${labels.instance}/metrics`,
      lastError: '',
      lastScrape: scraped ? new Date(EVAL_TS * 1000).toISOString() : '0001-01-01T00:00:00Z',
      lastScrapeDuration: scraped ? 0.01 : 0,
      health: scraped ? (value > 0 ? 'up' : 'down') : 'unknown',
    }));
}

/**
 * A mock Prometheus at `url` serving `series`. `fetch` is a drop-in for
 * globalThis.fetch. `queries` lists every instant query asked, in order;
 * `parseErrors` the ones the mock could not evaluate. Set `fail` to a
 * predicate to answer the queries it matches with HTTP 500, and `warnings` to
 * a function of the query giving the `warnings` to attach to its answer.
 *
 * It also answers /api/v1/targets (#470): with `targets` when set, else with
 * the targets of `series` (targetsOf). `targetReads` counts those reads, and
 * `failTargets` set answers them with HTTP 500.
 */
export function createMockPrometheus(series, { url = 'http://localhost:9997' } = {}) {
  const mock = {
    url,
    series,
    queries: [],
    parseErrors: [],
    fail: null,
    warnings: null,
    targets: null,
    targetReads: 0,
    failTargets: false,
    async fetch(requestUrl) {
      const u = new URL(String(requestUrl));
      if (String(requestUrl).startsWith(url) && u.pathname === '/api/v1/targets') {
        mock.targetReads += 1;
        if (mock.failTargets) return answer(500, { status: 'error', errorType: 'internal', error: 'boom' });
        const activeTargets = mock.targets ?? targetsOf(mock.series);
        return answer(200, { status: 'success', data: { activeTargets, droppedTargets: [] } });
      }
      if (!String(requestUrl).startsWith(url) || u.pathname !== '/api/v1/query') {
        throw new Error(`unexpected fetch ${requestUrl}`);
      }
      const q = u.searchParams.get('query');
      mock.queries.push(q);
      if (mock.fail?.(q)) return answer(500, { status: 'error', errorType: 'internal', error: 'boom' });
      let result;
      try {
        result = evaluate(q, mock.series);
      } catch (err) {
        mock.parseErrors.push(`${err.message} in: ${q}`);
        return answer(400, { status: 'error', errorType: 'bad_data', error: err.message });
      }
      const warnings = mock.warnings?.(q);
      return answer(200, {
        status: 'success',
        data: { resultType: 'vector', result },
        ...(warnings?.length ? { warnings } : {}),
      });
    },
  };
  return mock;
}

// ── A homelab ───────────────────────────────────────────────────────────

const GiB = 1073741824;
const TiB = 1024 * GiB;

/**
 * Series shaped like the homelab's Prometheus (read 2026-10-19): label sets,
 * hwmon chips, filesystems and container interfaces as they are there; the
 * values are made up. Four kinds of node:
 * - `pi`: node-exporter and cAdvisor; hwmon on an ADC and a thermal zone, the
 *   ADC listed first and cooler; `/` and /boot/firmware; containers on Docker
 *   bridges (eth0) and one on the host network (eth0, the eth0.10 VLAN,
 *   tailscale0 and br-* bridges; tailscale0 reads 0, as it does live).
 * - `vm`: node-exporter and cAdvisor (the first also has an extra target); no
 *   hwmon; `/`, /boot and an NFS mount larger than `/`; containers on one
 *   bridge, on three (eth0, eth1, eth2), and on the host network (ens18, the
 *   ens18.10 VLAN, tailscale0, br-*). Both VMs run a `prometheus` container.
 * - `nas`: node-exporter only; seven thermal zones, the hottest not first; no
 *   `/` (/home, /volume1, /ugreen, /overlay, /rootfs; /volume1 the largest).
 * - `pve`: node-exporter only; several hwmon chips, the hottest (a NIC) not
 *   first; `/` and FUSE mounts.
 * Every pi and vm also has a stopped container (stale last-seen) and an Arcane
 * helper container. `nodes` sets the node count (kinds in the order pi, pi,
 * vm, vm, nas, pve, repeated); one more node, `elsewhere`, is in Prometheus
 * but never asked for.
 *
 * Returns { labels, series }: the node labels in order, and every series.
 */
export function homelabSeries({ nodes = 6 } = {}) {
  const KINDS = ['pi', 'pi', 'vm', 'vm', 'nas', 'pve'];
  const count = {};
  const labels = [];
  const series = [];
  const add = (labelSet, value, rate) => series.push({ labels: labelSet, value, ...(rate !== undefined ? { rate } : {}) });

  for (let i = 0; i < nodes; i += 1) {
    const kind = KINDS[i % KINDS.length];
    count[kind] = (count[kind] ?? 0) + 1;
    const node = `${kind}${count[kind]}`;
    labels.push(node);
    addNode(add, { node, kind, i, first: count[kind] === 1 });
  }
  addNode(add, { node: 'elsewhere', kind: 'pi', i: nodes, first: false });
  return { labels, series };
}

function addNode(add, { node, kind, i, first }) {
  const ne = { instance: `${node}:9100`, job: `node-exporter-${node}`, node };
  const ca = { instance: `${node}:8080`, job: `cadvisor-${node}`, node };
  const cadvisor = kind === 'pi' || kind === 'vm';

  // Scrape targets
  add({ __name__: 'up', ...ne }, 1);
  if (cadvisor) add({ __name__: 'up', ...ca }, 1);
  if (kind === 'vm' && first) add({ __name__: 'up', instance: `${node}:9464`, job: 'arcane', node }, 1);

  // CPU: idle per core, as irate over the counter; one busy series that the
  // query must leave out.
  const cores = kind === 'pve' ? 16 : kind === 'nas' ? 8 : 4;
  for (let c = 0; c < cores; c += 1) {
    add({ __name__: 'node_cpu_seconds_total', ...ne, cpu: String(c), mode: 'idle' }, 1e6 + c, 0.7 + ((c + i) % 4) * 0.05);
    add({ __name__: 'node_cpu_seconds_total', ...ne, cpu: String(c), mode: 'user' }, 2e5 + c, 0.2);
  }

  // Memory
  const total = (kind === 'pve' ? 64 : kind === 'vm' ? 16 : 8) * GiB;
  add({ __name__: 'node_memory_MemTotal_bytes', ...ne }, total);
  add({ __name__: 'node_memory_MemAvailable_bytes', ...ne }, total * (0.55 - i * 0.01));
  add({ __name__: 'node_memory_MemFree_bytes', ...ne }, total * (0.15 + i * 0.005));
  add({ __name__: 'node_memory_Buffers_bytes', ...ne }, total * 0.02);

  // Uptime
  add({ __name__: 'node_time_seconds', ...ne }, EVAL_TS);
  add({ __name__: 'node_boot_time_seconds', ...ne }, EVAL_TS - (3 * 86400 + i * 3600 + 120));

  // Temperatures: the first series listed is never the hottest.
  const temp = (chip, sensor, v) => add({ __name__: 'node_hwmon_temp_celsius', ...ne, chip, sensor }, v);
  if (kind === 'pi') {
    temp('1000120000_pcie_1f000c8000_adc', 'temp1', 44.432 + i);
    temp('thermal_thermal_zone0', 'temp0', 44.65 + i);
    temp('thermal_thermal_zone0', 'temp1', 44.65 + i);
  } else if (kind === 'nas') {
    for (let z = 0; z < 7; z += 1) {
      const v = z === 3 ? 41.2 + i : 39.769;
      temp(`thermal_thermal_zone${z}`, 'temp0', v);
      temp(`thermal_thermal_zone${z}`, 'temp1', v);
    }
  } else if (kind === 'pve') {
    temp('0000:00:08_1_0000:c4:00_0', 'temp1', 31);
    temp('i2c_0_0_0050', 'temp1', 28.5);
    temp('nvme_nvme0', 'temp1', 27.85);
    temp('nvme_nvme0', 'temp2', 27.85);
    temp('pci0000:00_0000:00:18_3', 'temp1', 34.75);
    temp('r8169_0_200_r8169_0_200:00', 'temp1', 38 + i);
    temp('thermal_thermal_zone0', 'temp0', 20);
    temp('thermal_thermal_zone0', 'temp1', 20);
  }

  // Filesystems
  const fs = (mountpoint, fstype, device, size, free) => {
    add({ __name__: 'node_filesystem_size_bytes', ...ne, mountpoint, fstype, device }, size);
    add({ __name__: 'node_filesystem_free_bytes', ...ne, mountpoint, fstype, device }, free);
    add({ __name__: 'node_filesystem_avail_bytes', ...ne, mountpoint, fstype, device }, free * 0.95);
  };
  if (kind === 'pi') {
    fs('/run', 'tmpfs', 'tmpfs', 0.8 * GiB, 0.79 * GiB);
    fs('/', 'ext4', '/dev/mmcblk0p2', 58 * GiB, (40 - i) * GiB);
    fs('/boot/firmware', 'vfat', '/dev/mmcblk0p1', 0.5 * GiB, 0.4 * GiB);
  } else if (kind === 'vm') {
    fs('/run', 'tmpfs', 'tmpfs', 1.6 * GiB, 1.5 * GiB);
    fs('/mnt/share', 'nfs', 'nas:/volume1/share', 7 * TiB, 3 * TiB);
    fs('/', 'ext4', '/dev/sda2', 98 * GiB, (52 - i) * GiB);
    fs('/boot', 'ext4', '/dev/sda1', 2 * GiB, 1.7 * GiB);
    fs('/boot/efi', 'vfat', '/dev/sda15', 0.1 * GiB, 0.09 * GiB);
  } else if (kind === 'nas') {
    fs('/tmp', 'tmpfs', 'tmpfs', 16 * GiB, 16 * GiB);
    fs('/home', 'btrfs', '/dev/mapper/ug_vg1-volume_1', 7 * TiB, 3.1 * TiB);
    fs('/volume1', 'btrfs', '/dev/mapper/ug_vg1-volume_1', 7.2 * TiB, (3.3 - i * 0.01) * TiB);
    fs('/ugreen', 'ext4', '/dev/md9', 100 * GiB, 90 * GiB);
    fs('/overlay', 'ext4', '/dev/mmcblk0p8', 2 * GiB, 0.5 * GiB);
    fs('/rootfs', 'ext4', '/dev/mmcblk0p7', 2 * GiB, 0.2 * GiB);
  } else {
    fs('/etc/pve', 'fuse', '/dev/fuse', 0.1 * GiB, 0.1 * GiB);
    fs('/', 'ext4', '/dev/mapper/pve-root', 94 * GiB, (60 - i) * GiB);
    fs('/boot/efi', 'vfat', '/dev/nvme0n1p2', 1 * GiB, 0.9 * GiB);
    fs('/var/lib/lxcfs', 'fuse.lxcfs', 'lxcfs', 0, 0);
  }

  if (!cadvisor) return;

  // Containers: [name, interfaces, extra labels, seconds since cAdvisor saw it]
  const bridges = kind === 'pi' ? ['br-0595e3e371ec', 'br-27edd72da5e6'] : ['br-15956eedb25f', 'br-2b2a1c69cc8f', 'br-30dae4ec5440'];
  const hostIfaces =
    kind === 'pi' ? ['eth0', 'eth0.10', 'tailscale0', ...bridges] : ['ens18', 'ens18.10', 'tailscale0', ...bridges];
  const containers =
    kind === 'pi'
      ? [
          ['adguard', ['eth0']],
          ['tailscale', hostIfaces],
          ['cadvisor', ['eth0']],
          ['oldjob', ['eth0'], {}, 600],
          ['arcane-helper-1', ['eth0'], { [HELPER_LABEL]: 'true' }],
        ]
      : [
          ['gitea', ['eth0']],
          ['grafana', ['eth0', 'eth1', 'eth2']],
          ['jaghelm', hostIfaces],
          ['prometheus', ['eth0']],
          ['oldjob', ['eth0'], {}, 600],
          ['arcane-helper-1', ['eth0'], { [HELPER_LABEL]: 'true' }],
        ];
  containers.forEach(([name, ifaces, extra = {}, age = 5], k) => {
    const cl = { ...ca, name, id: `/system.slice/docker-${node}${k}.scope`, image: `example/${name}:latest`, ...extra };
    const ws = (100 + 37 * k + i) * 1048576;
    add({ __name__: 'container_last_seen', ...cl }, EVAL_TS - age);
    add({ __name__: 'container_cpu_usage_seconds_total', ...cl, cpu: 'total' }, 5000 + k, 0.01 * (k + 1) + i * 0.001);
    add({ __name__: 'container_memory_usage_bytes', ...cl }, ws + (50 + 11 * k) * 1048576);
    add({ __name__: 'container_memory_working_set_bytes', ...cl }, ws);
    ifaces.forEach((iface, j) => {
      const host = ifaces === hostIfaces;
      // tailscale0 reads 0 there, as it does live.
      const scale = iface === 'tailscale0' ? 0 : 1;
      add(
        { __name__: 'container_network_receive_bytes_total', ...cl, interface: iface },
        scale * ((host ? 9e9 : 3e8) * (j + 1) + k * 1e6),
        scale * ((host ? 40000 : 1500) / (j + 1) + k)
      );
      add(
        { __name__: 'container_network_transmit_bytes_total', ...cl, interface: iface },
        scale * ((host ? 4e9 : 1e8) * (j + 1) + k * 1e6),
        scale * ((host ? 20000 : 700) / (j + 1) + k)
      );
    });
  });
}
