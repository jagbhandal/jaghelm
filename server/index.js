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
import { initMonitors, fetchMonitors, getMonitorNames, matchMonitor, markMonitorLogDone } from './monitors.js';

// Phase 3 modules
import { initRegistry, getPreset, listPresets } from './integrations/registry.js';
import { fetchIntegration, testIntegration } from './integrations/handler.js';
import { initIconIndex, searchIcons, getIconCount } from './icons.js';

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
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));

// ── AUTH ──
const sessions = new Map();
const AUTH_USER = process.env.DASH_USER || 'admin';
const AUTH_PASS_ENV = process.env.DASH_PASS || '';
const AUTH_FILE = join(dataDir, 'auth.json');

function loadAuthOverride() {
  try {
    if (existsSync(AUTH_FILE)) {
      const data = JSON.parse(readFileSync(AUTH_FILE, 'utf8'));
      return data.passwordHash || null;
    }
  } catch {}
  return null;
}

// ── Password hashing: scrypt (Node.js built-in, no dependencies) ──
// Format: scrypt:salt:hash (all hex). Salt is 16 random bytes, hash is 64 bytes.
// Legacy SHA-256 hashes (64 hex chars, no colons) are auto-migrated on next login.

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  // New scrypt format: "scrypt:salt:hash"
  if (stored.startsWith('scrypt:')) {
    const [, salt, hash] = stored.split(':');
    const derived = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(hash, 'hex'));
  }
  // Legacy SHA-256 format: 64-char hex string
  if (stored.length === 64 && !stored.includes(':')) {
    const sha = crypto.createHash('sha256').update(password).digest('hex');
    return sha === stored;
  }
  return false;
}

let storedPasswordHash = loadAuthOverride();

function authEnabled() {
  return storedPasswordHash || (AUTH_PASS_ENV && AUTH_PASS_ENV !== 'REPLACE_ME' && AUTH_PASS_ENV.length > 0);
}

function checkPassword(password) {
  if (storedPasswordHash) {
    const match = verifyPassword(password, storedPasswordHash);
    // Auto-migrate legacy SHA-256 hash to scrypt on successful login
    if (match && !storedPasswordHash.startsWith('scrypt:')) {
      console.log('[auth] Migrating password hash from SHA-256 to scrypt');
      storedPasswordHash = hashPassword(password);
      try {
        writeFileSync(AUTH_FILE, JSON.stringify({ passwordHash: storedPasswordHash, updatedAt: new Date().toISOString() }, null, 2));
      } catch (err) {
        console.error('[auth] Failed to save migrated hash:', err.message);
      }
    }
    return match;
  }
  return password === AUTH_PASS_ENV;
}

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
  if (username === AUTH_USER && checkPassword(password)) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { user: username, created: Date.now() });
    return res.json({ token, user: username });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

app.get('/api/auth/check', (req, res) => {
  if (!authEnabled()) return res.json({ authenticated: true, authRequired: false });
  const token = req.headers['x-auth-token'];
  if (token && sessions.has(token)) return res.json({ authenticated: true, authRequired: true, user: AUTH_USER });
  res.json({ authenticated: false, authRequired: true });
});

app.post('/api/auth/change-password', authMiddleware, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Missing current or new password' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  if (!checkPassword(currentPassword)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  try {
    storedPasswordHash = hashPassword(newPassword);
    writeFileSync(AUTH_FILE, JSON.stringify({ passwordHash: storedPasswordHash, updatedAt: new Date().toISOString() }, null, 2));
    // Invalidate all sessions except the current one
    const currentToken = req.headers['x-auth-token'];
    for (const [token] of sessions) {
      if (token !== currentToken) sessions.delete(token);
    }
    console.log('[auth] Password changed successfully');
    res.json({ ok: true });
  } catch (err) {
    console.error('[auth] Failed to save password:', err.message);
    res.status(500).json({ error: 'Failed to save new password' });
  }
});

// ── CACHE ──
const cache = new Map();
const CACHE_TTL = 15000;
function getCached(k) { const e = cache.get(k); return e && Date.now() - e.ts < CACHE_TTL ? e.data : null; }
function setCache(k, d) { cache.set(k, { data: d, ts: Date.now() }); }
function shouldBypassCache(req) { return !!req.query.nocache; }

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
app.use('/api/display-config', authMiddleware);

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
  const bust = shouldBypassCache(req);
  if (!bust) {
    const cached = getCached('services');
    if (cached) return res.json(cached);
  }

  try {
    const config = getConfig();
    if (!config || !config.nodes || Object.keys(config.nodes).length === 0) {
      return res.json({ nodes: {} });
    }

    // Fetch all monitors once (bust cache if client requested fresh data)
    const monitors = await fetchMonitors(bust);

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

          // Status priority:
          // 1. Kuma monitor status (up/down) — most authoritative
          // 2. Docker running state from cAdvisor — container exists and is running
          // 3. 'unknown' — should never happen since cAdvisor only reports live containers
          const status = monitor?.status || c.status || 'unknown';

          return {
            container: c.container,
            uid: `${nodeKey}:${c.container}`,
            display_name: displayName,
            icon: override.icon || null,
            status,
            monitored: !!monitor,
            ping: monitor?.ping || null,
            uptime24: monitor?.uptime24 || null,
            docker: c.docker,
            integration: null,
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
    markMonitorLogDone(); // Stop logging unmatched containers after first build
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

// ── Display Config (server-side persistence for UI settings, layout, theme) ──
const DISPLAY_CONFIG_PATH = join(dataDir, 'display-config.json');

app.get('/api/display-config', (req, res) => {
  try {
    if (existsSync(DISPLAY_CONFIG_PATH)) {
      const raw = readFileSync(DISPLAY_CONFIG_PATH, 'utf8');
      const data = JSON.parse(raw);
      return res.json(data);
    }
    res.json(null);
  } catch (err) {
    console.error('[display-config] Failed to read:', err.message);
    res.json(null);
  }
});

app.post('/api/display-config', (req, res) => {
  try {
    const config = req.body;
    if (!config || typeof config !== 'object') {
      return res.status(400).json({ error: 'Invalid config' });
    }
    writeFileSync(DISPLAY_CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log('[display-config] Saved (%d keys)', Object.keys(config).length);
    res.json({ ok: true });
  } catch (err) {
    console.error('[display-config] Failed to save:', err.message);
    res.status(500).json({ error: 'Failed to save display config', detail: err.message });
  }
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
    const queryMap = {
      status: 'nut_status{ups="apcups"}',
      charge: 'nut_battery_charge{ups="apcups"}',
      runtime: 'nut_battery_runtime_seconds{ups="apcups"}',
      load: 'nut_load{ups="apcups"}',
    };
    const keys = Object.keys(queryMap);
    const responses = await Promise.all(
      keys.map(k =>
        safeFetch(`${url}/api/v1/query?query=${encodeURIComponent(queryMap[k])}`)
          .then(r => r.json())
          .then(d => d?.data?.result?.[0]?.value?.[1] ? parseFloat(d.data.result[0].value[1]) : null)
          .catch(() => null)
      )
    );
    const results = {};
    let found = false;
    keys.forEach((k, i) => {
      let val = responses[i];
      if (val !== null) {
        found = true;
        if (k === 'charge' || k === 'load') val = val * 100;
      }
      results[k] = val;
    });
    if (!found) { results.status = null; results.charge = null; results.runtime = null; results.load = null; }
    setCache('ups', results);
    res.json(results);
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

// ══════════════════════════════════════════════════════════════
// ICON SEARCH
// ══════════════════════════════════════════════════════════════

app.get('/api/icons', authMiddleware, (req, res) => {
  const q = (req.query.q || '').trim();
  const limit = Math.min(parseInt(req.query.limit) || 60, 200);
  const results = searchIcons(q, limit);
  res.json({ count: getIconCount(), results });
});

// ══════════════════════════════════════════════════════════════
// PHASE 3: INTEGRATION ENGINE
// ══════════════════════════════════════════════════════════════

// List all available presets (for Settings UI gallery)
app.get('/api/integrations/presets', authMiddleware, (req, res) => {
  res.json(listPresets());
});

// Fetch data from a configured integration
app.get('/api/integrations/:type', authMiddleware, async (req, res) => {
  const { type } = req.params;
  const bust = shouldBypassCache(req);

  // Get integration config from services.yaml
  const config = getConfig();
  const integrations = config?.integrations || {};
  const yamlConfig = integrations[type];

  if (!yamlConfig && !getPreset(type)) {
    return res.status(404).json({ error: `Integration '${type}' not found` });
  }

  const result = await fetchIntegration(type, yamlConfig || {}, bust);
  if (result.error) {
    return res.status(502).json({ error: result.error, fields: result.fields });
  }
  res.json(result);
});

// Test connection before saving (credentials come from the request body, not stored yet)
app.post('/api/integrations/test', authMiddleware, async (req, res) => {
  const { type, url, username, password, token } = req.body;
  if (!url) return res.status(400).json({ ok: false, error: 'URL is required' });

  // Auto-prepend protocol if missing
  let cleanUrl = url.trim();
  if (cleanUrl && !cleanUrl.match(/^https?:\/\//i)) {
    cleanUrl = `http://${cleanUrl}`;
  }

  const testConfig = { url: cleanUrl, username, password, token };
  const result = await testIntegration(type || '_custom', testConfig);
  res.json(result);
});

// Save an integration config (encrypts credentials, stores config in services.yaml)
// Supports multiple instances of the same preset via the `instance` field.
// e.g. type=adguard, instance=primary → stored as adguard_primary
app.post('/api/integrations/save', authMiddleware, async (req, res) => {
  const { type, instance, url, username, password, token, enabled, target, editingKey, fields: customFields } = req.body;
  if (!type || !url) return res.status(400).json({ error: 'type and url are required' });

  // Auto-prepend protocol if missing
  let cleanUrl = url.trim();
  if (cleanUrl && !cleanUrl.match(/^https?:\/\//i)) {
    cleanUrl = `http://${cleanUrl}`;
  }

  // Build storage key — append instance name if provided (e.g. adguard_primary)
  const storageKey = instance ? `${type}_${instance}` : type;

  try {
    // Encrypt credentials into secrets.json
    if (password) {
      setSecret(`integration_${storageKey}_password`, password);
    }
    if (token) {
      setSecret(`integration_${storageKey}_token`, token);
    }

    // Build the config entry (credentials stored as $secret: refs)
    const entry = {
      url: cleanUrl,
      enabled: enabled !== false,
    };

    // Store the preset type so the handler knows which preset to use
    if (getPreset(type)) {
      entry.preset = type;
    }

    // Instance label (for display in UI)
    if (instance) entry.instance = instance;

    // Target container UID (e.g. "pi:adguard-home") — for scoped matching
    if (target) entry.target = target;

    // Credential references (never plaintext)
    if (username) entry.username = username;
    if (password) entry.password = `$secret:integration_${storageKey}_password`;
    if (token) entry.token = `$secret:integration_${storageKey}_token`;

    // Custom fields (only for non-preset integrations)
    if (customFields) entry.fields = customFields;

    // Save to services.yaml under integrations section
    const config = getConfig() || {};
    if (!config.integrations) config.integrations = {};

    // If editing and the key changed (e.g. adguard → adguard_primary), remove the old entry
    if (editingKey && editingKey !== storageKey) {
      delete config.integrations[editingKey];
    }

    config.integrations[storageKey] = entry;
    saveConfig(config);

    res.json({ ok: true, type: storageKey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete an integration config
app.delete('/api/integrations/:type', authMiddleware, async (req, res) => {
  const { type } = req.params;
  const config = getConfig() || {};
  if (!config.integrations?.[type]) {
    return res.status(404).json({ error: `Integration '${type}' not configured` });
  }

  delete config.integrations[type];
  saveConfig(config);
  res.json({ ok: true });
});

// Fetch all configured integrations' data in one call (for dashboard)
app.get('/api/integrations', authMiddleware, async (req, res) => {
  const bust = shouldBypassCache(req);
  const config = getConfig();
  const integrations = config?.integrations || {};

  const results = {};
  const promises = Object.entries(integrations)
    .filter(([, cfg]) => cfg.enabled !== false)
    .map(async ([key, cfg]) => {
      // Use the preset type for the handler, not the storage key
      const handlerType = cfg.preset || key;
      const result = await fetchIntegration(handlerType, cfg, bust);
      const entry = { ...(result.fields || {}) };
      if (result.vms) entry._vms = result.vms;
      // Include target so frontend knows which container to match
      if (cfg.target) entry._target = cfg.target;
      if (cfg.instance) entry._instance = cfg.instance;
      results[key] = entry;
    });

  await Promise.allSettled(promises);
  res.json(results);
});

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
  await initRegistry();

  // Load icon index in background (non-blocking — search works once ready)
  initIconIndex().catch(err => console.warn('[icons] Background init failed:', err.message));

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