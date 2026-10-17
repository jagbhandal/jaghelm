#!/usr/bin/env node
/**
 * Arcane dry run for UAT. Runs the real poller twice against a live Arcane,
 * over throwaway temp stores, so nothing touches JagHelm's data dir and no
 * push is sent. The second pass shows real transitions against the first
 * baseline.
 *
 *   ARCANE_URL=... ARCANE_API_KEY=... [ARCANE_CHECK_ONLY_ENVS=pi-1,pi-2] \
 *     node scripts/arcane-poll-once.js [--record <dir>]
 *
 * --record writes each response, projected to the fields the client reads
 * (no labels, env or anything else), under the fixture names in
 * server/arcane/fixtures/. The API key is never printed.
 */
import { runPollOnce } from '../server/arcane/pollOnce.js';

process.exitCode = await runPollOnce({ argv: process.argv.slice(2) });
