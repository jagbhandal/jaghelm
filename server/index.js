/**
 * JagHelm v8.0 — Express Server
 * 
 * Phase 1: Foundation
 * - Config manager (services.yaml load/save/watch)
 * - Secrets manager (AES-256-GCM encrypted credentials)
 * - Discovery engine (nodes + containers from Prometheus)
 * - Monitor matcher (Uptime Kuma auto-matching)
 * - Unified GET /api/services endpoint
 */

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import crypto from 'crypto';
import http from 'http';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import dotenv from 'dotenv';
dotenv.config();

// Phase 1 modules
import { loadConfig, saveConfig, getConfig, generateDefaultConfig, startConfigWatcher } from './config.js';
import { initSecrets, resolveCredential, setSecret, deleteSecret, listSecretKeys } from './secrets.js';
import { initDiscovery, discoverNodes, getNodeMetrics, discoverContainers } from './discovery.js';
import { initMonitors, fetchMonitors, getMonitorNames, matchMonitor } from './monitors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3099;

const uploadsDir = join(__dirname, '..', 'uploads');
const dataDir = join(__dirname, '..', 'data');
if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${req.query.type === 'logo' ? 'logo' : 'bg'}${extname(file.originalname) || '.png'}`),
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));

// ── AUTH (unchanged from v7) ──
const sessions = new Map();
const AUTH_USER = process.env.DASH_USER || 'admin';
const AUTH_PASS = process.env.DASH_PASS || '';

function authEnabled() { return AUTH_PASS && AUTH_PASS !== 'REPLACE_ME' && AUTH_PASS.length > 0; }

function authMiddleware(req, res, next) {
  if (!authEnabled()) return next();
  const token = req.headers['x-auth-token'] || req.query.token;
  if (token && sessions.has(token)) {
    const s = sessions.get(token);
    if (Date.now() - s.created < 86400000) return next();
    sessions.delete(token);
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

app.post('/api/auth/login', (req, res) => {
  if (!authEnabled()) return res.json({ token: 'noauth', user: 'admin' });
  const { username, password } = req.body;
  if (username === AUTH_USER && password === AUTH_PASS) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { user: username, created: Date.now() });
    return res.json({ token, user: username });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

app.get('/api/auth/check', (req, res) => {
  if (!authEnabled()) return res.json({ authenticated: true, authRequired: false });
  const token = req.headers['x-auth-token'];
  if (token && sessions.has(token)) return res.json({ authenticated: true, authRequired: true });
  res.json({ authenticated: false, authRequired: true });
});

// ── CACHE ──
const cache = new Map();
const CACHE_TTL = 15000;
function getCached(k) { const e = cache.get(k); return e && Date.now() - e.ts < CACHE_TTL ? e.data : null; }
function setCache(k, d) { cache.set(k, { data: d, ts: Date.now() }); }
function shouldBypassCache(req) { return req.query.nocache === '1'; }

async function safeFetch(url, opts = {}) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(8000) });
}

// ── PROTECTED ROUTES ──
app.use('/api/upload', authMiddleware);
app.use('/api/services', authMiddleware);
app.use('/api/secrets', authMiddleware);
app.use('/api/weather', authMiddleware);
app.use('/api/todos', authMiddleware);
app.use('/api/gitea', authMiddleware);
app.use('/api/uptime', authMiddleware);
app.use('/api/prometheus', authMiddleware);
app.use('/api/adguard', authMiddleware);
app.use('/api/ups', authMiddleware);
app.use('/api/npm', authMiddleware);
app.use('/api/docker', authMiddleware);

// ══════════════════════════════════════════════════════════════
// PHASE 1: Unified /api/services endpoint
// ══════════════════════════════════════════════════════════════

/**
 * GET /api/services
 * Returns complete merged service data:
 * - Node metrics from Prometheus
 * - Container stats (CPU, MEM, RX, TX) from cAdvisor
 * - Uptime Kuma health status per service
 * - Config overrides (display names, icons, visibility)
 */
app.get('/api/services', async (req, res) => {
  if (!shouldBypassCache(req)) {
    const cached = getCached('services');
    if (cached) return res.json(cached);
  }

  try {
    const config = getConfig();
    if (!config || !config.nodes || Object.keys(config.nodes).length === 0) {
      return res.json({ nodes: {} });
    }

    // Fetch all monitors once
    const monitors = await fetchMonitors();

    // Build response for each node in parallel
    const nodeEntries = await Promise.all(
      Object.entries(config.nodes).map(async ([nodeKey, nodeCfg]) => {
        if (nodeCfg.visible === false) return null;

        const promLabel = nodeCfg.prometheus_node || nodeKey;

        // Get node-level metrics
        const metrics = await getNodeMetrics(promLabel);

        // Discover containers on this node
        let containers = await discoverContainers(promLabel);

        // Filter out hidden containers
        const hideList = (nodeCfg.hide || []).map(h => h.toLowerCase());
        containers = containers.filter(
          c => !hideList.some(h => c.container.toLowerCase().includes(h))
        );

        // Apply config overrides + monitor matching
        const services = containers.map(c => {
          const override = config.services?.[c.container] || {};
          const displayName = override.display_name || formatContainerName(c.container);
          const explicitMonitor = override.monitor || null;
          const monitor = matchMonitor(c.container, explicitMonitor, monitors);

          return {
            container: c.container,
            display_name: displayName,
            icon: override.icon || null,
            status: monitor?.status || 'unknown',
            ping: monitor?.ping || null,
            uptime24: monitor?.uptime24 || null,
            docker: c.docker,
            integration: null, // Phase 3
          };
        });

        services.sort((a, b) => a.display_name.localeCompare(b.display_name));

        return [nodeKey, {
          display_name: nodeCfg.display_name || nodeKey,
          subtitle: nodeCfg.subtitle || '',
          icon: nodeCfg.icon || '🖥',
          border_color: nodeCfg.border_color || '#6366f1',
          metrics,
          services,
        }];
      })
    );

    const nodes = Object.fromEntries(nodeEntries.filter(Boolean));
    const result = { nodes };
    setCache('services', result);
    res.json(result);
  } catch (err) {
    console.error('[services] Error building service data:', err);
    res.status(500).json({ error: 'Failed to build service data', detail: err.message });
  }
});

function formatContainerName(name) {
  return name
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ── Config API ──

app.get('/api/services/config', (req, res) => {
  res.json(getConfig() || {});
});

app.post('/api/services/config', (req, res) => {
  const newConfig = req.body;
  if (!newConfig || typeof newConfig !== 'object') {
    return res.status(400).json({ error: 'Invalid config' });
  }
  const ok = saveConfig(newConfig);
  res.json({ ok });
});

app.get('/api/services/monitors', async (req, res) => {
  const names = await getMonitorNames();
  res.json(names);
});

// ── Secrets API ──

app.get('/api/secrets/keys', (req, res) => {
  res.json(listSecretKeys());
});

app.put('/api/secrets/:key', (req, res) => {
  const { key } = req.params;
  const { value } = req.body;
  if (!value) return res.status(400).json({ error: 'Missing value' });
  const ok = setSecret(key, value);
  if (!ok) return res.status(500).json({ error: 'Secrets manager not initialized (DASH_SECRET missing?)' });
  res.json({ ok: true, key });
});

app.delete('/api/secrets/:key', (req, res) => {
  const ok = deleteSecret(req.params.key);
  res.json({ ok, key: req.params.key });
});

// ══════════════════════════════════════════════════════════════
// LEGACY ENDPOINTS (kept for backward compat during migration)
// ══════════════════════════════════════════════════════════════

app.get('/api/uptime/monitors', async (req, res) => {
  try {
    const monitors = await fetchMonitors();
    res.json(monitors);
  } catch (e) { res.status(502).json({ error: 'Uptime Kuma unreachable', detail: e.message }); }
});

app.get('/api/prometheus/query', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing q' });
  const ck = `prom-${q}`;
  if (!shouldBypassCache(req)) {
    const cached = getCached(ck);
    if (cached) return res.json(cached);
  }
  try {
    const url = process.env.PROMETHEUS_URL || 'http://localhost:9090';
    const r = await safeFetch(`${url}/api/v1/query?query=${encodeURIComponent(q)}`);
    const data = await r.json();
    setCache(ck, data);
    res.json(data);
  } catch (e) { res.status(502).json({ error: 'Prometheus unreachable', detail: e.message }); }
});

app.get('/api/adguard/stats', async (req, res) => {
  if (!shouldBypassCache(req)) {
    const cached = getCached('adguard');
    if (cached) return res.json(cached);
  }
  try {
    const url = process.env.ADGUARD_URL || 'http://192.168.68.13:8085';
    const u = process.env.ADGUARD_USER || '';
    const p = process.env.ADGUARD_PASS || '';
    const headers = {};
    if (u && p) headers['Authorization'] = 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');
    const r = await safeFetch(`${url}/control/stats`, { headers });
    const data = await r.json();
    setCache('adguard', data);
    res.json(data);
  } catch (e) { res.status(502).json({ error: 'AdGuard unreachable', detail: e.message }); }
});

app.get('/api/ups', async (req, res) => {
  if (!shouldBypassCache(req)) {
    const cached = getCached('ups');
    if (cached) return res.json(cached);
  }
  try {
    const url = process.env.PROMETHEUS_URL || 'http://localhost:9090';
    const metricSets = [
      { status: 'network_ups_tools_ups_status', charge: 'network_ups_tools_battery_charge', runtime: 'network_ups_tools_battery_runtime_seconds', load: 'network_ups_tools_ups_load' },
      { status: 'nut_status', charge: 'nut_battery_charge', runtime: 'nut_battery_runtime_seconds', load: 'nut_load' },
      { status: 'nut_ups_status', charge: 'nut_battery_charge_percent', runtime: 'nut_battery_runtime_seconds', load: 'nut_ups_load_percent' },
    ];
    for (const qs of metricSets) {
      const results = {};
      let found = false;
      for (const [k, query] of Object.entries(qs)) {
        try {
          const r = await safeFetch(`${url}/api/v1/query?query=${encodeURIComponent(query)}`);
          const d = await r.json();
          const val = d?.data?.result?.[0]?.value?.[1] ? parseFloat(d.data.result[0].value[1]) : null;
          results[k] = val;
          if (val !== null) found = true;
        } catch { results[k] = null; }
      }
      if (found) { setCache('ups', results); return res.json(results); }
    }
    const empty = { status: null, charge: null, runtime: null, load: null };
    setCache('ups', empty);
    res.json(empty);
  } catch (e) { res.status(502).json({ error: 'UPS unreachable', detail: e.message }); }
});

app.get('/api/npm/stats', async (req, res) => {
  if (!shouldBypassCache(req)) {
    const cached = getCached('npm-stats');
    if (cached) return res.json(cached);
  }
  try {
    const url = process.env.NPM_URL || 'http://192.168.68.13:81';
    const npmUser = process.env.NPM_USER || 'admin@example.com';
    const npmPass = process.env.NPM_PASS || '';
    let token = '';
    if (npmPass) {
      try {
        const authR = await safeFetch(`${url}/api/tokens`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identity: npmUser, secret: npmPass }),
        });
        const authD = await authR.json();
        token = authD?.token || '';
      } catch {}
    }
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    let hosts = 0, online = 0, certs = 0;
    try {
      const r = await safeFetch(`${url}/api/nginx/proxy-hosts`, { headers });
      const data = await r.json();
      if (Array.isArray(data)) {
        hosts = data.length;
        online = data.filter(h => h.enabled === 1).length;
        certs = data.filter(h => h.certificate_id > 0).length;
      }
    } catch {}
    const result = { hosts, online, certs };
    setCache('npm-stats', result);
    res.json(result);
  } catch (e) { res.status(502).json({ error: 'NPM unreachable', detail: e.message }); }
});

app.get('/api/docker/containers', async (req, res) => {
  if (!shouldBypassCache(req)) {
    const cached = getCached('docker-containers');
    if (cached) return res.json(cached);
  }
  const promUrl = process.env.PROMETHEUS_URL || 'http://localhost:9090';
  try {
    const [namesR, cpuR, memR] = await Promise.all([
      safeFetch(`${promUrl}/api/v1/query?query=${encodeURIComponent('container_last_seen{name!=""}')}`).then(r => r.json()).catch(() => null),
      safeFetch(`${promUrl}/api/v1/query?query=${encodeURIComponent('rate(container_cpu_usage_seconds_total{name!=""}[5m]) * 100')}`).then(r => r.json()).catch(() => null),
      safeFetch(`${promUrl}/api/v1/query?query=${encodeURIComponent('container_memory_usage_bytes{name!=""}')}`).then(r => r.json()).catch(() => null),
    ]);
    const containers = {};
    const allResults = [...(namesR?.data?.result || []), ...(cpuR?.data?.result || []), ...(memR?.data?.result || [])];
    for (const r of allResults) {
      const name = r.metric?.name;
      if (name && !containers[name]) containers[name] = { name, cpu: null, memMB: null, status: 'running' };
    }
    for (const r of (cpuR?.data?.result || [])) {
      const name = r.metric?.name;
      if (name && containers[name]) containers[name].cpu = r.value?.[1] ? parseFloat(parseFloat(r.value[1]).toFixed(1)) : null;
    }
    for (const r of (memR?.data?.result || [])) {
      const name = r.metric?.name;
      if (name && containers[name]) containers[name].memMB = r.value?.[1] ? parseFloat((parseFloat(r.value[1]) / 1048576).toFixed(1)) : null;
    }
    if (Object.keys(containers).length > 0) {
      const result = Object.values(containers).sort((a, b) => a.name.localeCompare(b.name));
      setCache('docker-containers', result);
      return res.json(result);
    }
  } catch {}
  try {
    const data = await new Promise((resolve, reject) => {
      const rq = http.get({ socketPath: '/var/run/docker.sock', path: '/containers/json' }, (resp) => {
        let body = '';
        resp.on('data', c => body += c);
        resp.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
      });
      rq.on('error', reject);
      rq.setTimeout(5000, () => { rq.destroy(); reject(new Error('timeout')); });
    });
    const containers = (data || []).map(c => ({
      name: (c.Names?.[0] || '').replace(/^\//, ''),
      image: c.Image?.split(':')[0]?.split('/').pop() || c.Image,
      status: c.State || 'unknown', state: c.Status || '',
    }));
    setCache('docker-containers', containers);
    res.json(containers);
  } catch { res.json([]); }
});

// ── Gitea Activity (stays as dedicated endpoint per spec) ──
app.get('/api/gitea/activity', async (req, res) => {
  if (!shouldBypassCache(req)) {
    const cached = getCached('gitea');
    if (cached) return res.json(cached);
  }
  try {
    const url = process.env.GITEA_URL || 'http://localhost:3060';
    const token = process.env.GITEA_TOKEN || '';
    const repo = process.env.GITEA_REPO || 'jagdeep.bhandal/homelab-infra';
    const r = await safeFetch(`${url}/api/v1/repos/${repo}/commits?limit=5${token ? '&token=' + token : ''}`);
    const data = await r.json();
    const commits = Array.isArray(data) ? data.map(c => ({
      sha: c.sha?.substring(0, 7), message: c.commit?.message?.split('\n')[0] || '',
      date: c.commit?.author?.date || '', author: c.commit?.author?.name || '',
    })) : [];
    setCache('gitea', commits);
    res.json(commits);
  } catch (e) { res.status(502).json({ error: 'Gitea unreachable', detail: e.message }); }
});

// ── Weather + Todos (unchanged) ──
app.get('/api/weather', async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: 'Missing lat/lon' });
  const ck = `weather-${lat}-${lon}`;
  const cached = getCached(ck);
  if (cached) return res.json(cached);
  try {
    const r = await safeFetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph`);
    const data = await r.json();
    setCache(ck, data);
    res.json(data);
  } catch (e) { res.status(502).json({ error: 'Weather unreachable', detail: e.message }); }
});

app.get('/api/todos', (req, res) => {
  try { res.json(JSON.parse(readFileSync(join(dataDir, 'todos.json'), 'utf8'))); }
  catch { res.json([]); }
});
app.post('/api/todos', (req, res) => {
  writeFileSync(join(dataDir, 'todos.json'), JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: `/uploads/${req.file.filename}`, filename: req.file.filename });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime(), version: '8.0.0-alpha.1' }));

// ── Static + SPA fallback ──
const distPath = join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get('*', (req, res) => res.sendFile(join(distPath, 'index.html')));

// ══════════════════════════════════════════════════════════════
// STARTUP
// ══════════════════════════════════════════════════════════════

async function boot() {
  const promUrl = process.env.PROMETHEUS_URL || 'http://localhost:9090';
  const kumaUrl = process.env.KUMA_URL || 'http://localhost:3001';

  // Initialize subsystems
  initSecrets();
  initDiscovery(promUrl);
  initMonitors(kumaUrl);

  // Load or generate config
  let config = loadConfig();
  if (!config) {
    console.log('[boot] First boot — running node discovery...');
    const nodeLabels = await discoverNodes();
    console.log('[boot] Discovered nodes:', nodeLabels);
    config = generateDefaultConfig(nodeLabels);
    saveConfig(config);
  }

  // Start watching for external config changes
  startConfigWatcher();

  // Start server
  app.listen(PORT, '0.0.0.0', () => {
    console.log('[jaghelm] v8.0.0-alpha.1 on port %d', PORT);
    console.log('[jaghelm] Nodes: %s', Object.keys(config.nodes || {}).join(', ') || '(none)');
  });
}

boot().catch(err => {
  console.error('[jaghelm] Fatal boot error:', err);
  process.exit(1);
});
