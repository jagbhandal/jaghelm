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
 * --vuln-digest runs the weekly vulnerability digest instead, the same way: twice
 * over a throwaway state file, printing what would push and sending nothing.
 *
 * --record writes each response, projected to the fields the client reads
 * (no labels, env or anything else), under the fixture names used in
 * server/arcane/fixtures/. Record into server/arcane/fixtures/live/: the files
 * directly in fixtures/ are hand-built scenarios the unit tests depend on.
 * The API key is never printed.
 */
import { main } from '../server/arcane/pollOnce.js';

process.exitCode = await main({ argv: process.argv.slice(2) });
