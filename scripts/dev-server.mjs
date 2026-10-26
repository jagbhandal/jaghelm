// `npm run dev:server`: the server with PROMETHEUS_URL set for a dev box (#704).
// JagHelm has no default for it (inside the shipped container, localhost is
// JagHelm itself), so a dev box says where its Prometheus is: its own .env
// first, else the local one. KUMA_URL stays unset (Kuma is optional).
import 'dotenv/config';

process.env.PROMETHEUS_URL ||= 'http://localhost:9090';
await import('../server/index.js');
