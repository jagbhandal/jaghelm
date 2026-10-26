// `npm run dev:server`: the server with PROMETHEUS_URL set for a dev box (#704).
// JagHelm has no default for it (inside the shipped container, localhost is
// JagHelm itself), so a dev box says where its Prometheus is: its own .env
// first, else the local one. KUMA_URL stays unset (Kuma is optional).
// server/index.js boots only when it is the entry script, so it runs as a child.
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const env = { ...process.env, PROMETHEUS_URL: process.env.PROMETHEUS_URL || 'http://localhost:9090' };
const entry = fileURLToPath(new URL('../server/index.js', import.meta.url));
const child = spawn(process.execPath, [entry], { env, stdio: 'inherit' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
