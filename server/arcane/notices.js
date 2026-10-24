/**
 * Arcane's notices go through the push outbox (#581): the poller's (updates,
 * held-back updates, agents, releases) and the weekly vulnerability digest's.
 *
 * Each of them is a producer of the push snapshot (push/dispatch.js
 * createPushSnapshot notify): its state, what it has already notified, lives
 * in push-snapshot.json under `producers`, and each poll or digest run ends
 * with one commit that writes that state, records the run's notices in the
 * alert history and queues them for the sender, in one atomic write. So a
 * crash before the write leaves the old state and the next run finds the same
 * news and queues it once; a crash after it leaves the notices queued with the
 * state that made them, and nothing is found twice. Two files (the state's,
 * then the outbox's) could not do that: whichever was written first, a crash
 * between them would lose the notice or repeat it. The commit never waits on
 * a send: it wakes the sender, which sends in order and retries what the push service
 * failed, so neither loop waits on it.
 *
 * The state moved there from the producers' own files. The first start of a
 * JagHelm with #581 reads them once, writes what they held into the snapshot
 * and leaves them in place, for a rollback. After that the snapshot's copy is
 * used, unless an old file was written since it was taken (its mtime after the
 * entry's `savedAt`, #581 review): an older JagHelm ran after a rollback and
 * kept notifying into its own files, while the snapshot's copy stayed as it was
 * (an older JagHelm leaves `producers` alone), so the old files are what was
 * last notified, and are read again. Not when the snapshot file was there but
 * unreadable (it is moved aside, push/dispatch.js): what was lost may be newer
 * than the old files, which would replay what was notified since, so each
 * producer starts fresh, as a first start does (a silent baseline).
 *
 * With push off the notices are still recorded (`off`), and the state still
 * moves, so turning push on later sends nothing old.
 */
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

import { createLogger } from '../util/logger.js';
import { createHeldBackStore } from '../watchtower/heldBackStore.js';
import { createArcaneStateStore } from './stateStore.js';
import { createVulnStateStore } from './vulnStateStore.js';

const defaultLog = createLogger('arcane');

/** The producers' names in push-snapshot.json. */
export const POLLER = 'arcane';
export const DIGEST = 'arcane-vulns';

/** The files each kept its state in before #581, in the data directory. */
export const OLD_FILES = Object.freeze({
  state: 'arcane-state.json',
  heldBack: 'arcane-held-back.json',
  vulns: 'arcane-vuln-state.json',
});

/** An old state file's content, or undefined when it is missing or doesn't parse (as its store read it). */
function readOld(path) {
  try {
    if (!existsSync(path)) return undefined;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

/** When the newest of `paths` was last written (ms), or -Infinity with none there. */
function newestWrite(paths) {
  let newest = -Infinity;
  for (const path of paths) {
    try {
      newest = Math.max(newest, statSync(path).mtimeMs);
    } catch {
      // Not there: no write.
    }
  }
  return newest;
}

/**
 * What a producer starts from: what the snapshot holds for it, or its old
 * files' content (`files`: part -> file name) when the snapshot holds none or
 * an old file was written after the snapshot's copy was taken. Neither after
 * an unreadable snapshot. `from`: 'snapshot', 'first' (the upgrade), 'newer'
 * (an older JagHelm wrote them since) or 'none'.
 */
function startingState({ snapshot, name, dir, files }) {
  if (snapshot.unreadable()) return { state: {}, from: 'none' };
  const saved = snapshot.producerState(name);
  const paths = Object.values(files).map((file) => join(dir, file));
  if (saved !== undefined && !(newestWrite(paths) > (saved.savedAt ?? -Infinity))) {
    return { state: saved.state, from: 'snapshot' };
  }
  const state = {};
  let read = false;
  for (const [part, file] of Object.entries(files)) {
    const content = readOld(join(dir, file));
    if (content === undefined) continue;
    state[part] = content;
    read = true;
  }
  if (!read) return saved === undefined ? { state, from: 'none' } : { state: saved.state, from: 'snapshot' };
  return { state, from: saved === undefined ? 'first' : 'newer' };
}

/** The log line for a state taken from the old files. */
const TAKEN = {
  first: 'state moved into push-snapshot.json; the old files stay for a rollback',
  newer: 'state taken from the old files, written since push-snapshot.json took it (an older JagHelm ran after a rollback)',
};

/**
 * The commit a producer ends each run with. `stores`: the stores whose
 * `revision()` says whether there is anything new to write; `toState()` what
 * goes into the file. Never throws, never waits on a send.
 */
function createCommit({ name, snapshot, sender, isPushEnabled, stores, toState, logger }) {
  const revisions = () => stores.map((s) => s.revision()).join(':');
  let filed = revisions();
  function write(events) {
    try {
      const push = isPushEnabled();
      snapshot.notify(name, toState(), events, { push });
      filed = revisions();
      if (push && events.length > 0) sender.wake();
    } catch (err) {
      // Never seen: the snapshot's own write failures are logged and retried there.
      logger.error({ err, producer: name, events: events.length }, 'Arcane notices not committed');
    }
  }
  return {
    /**
     * Write the state with `events`: recorded, and queued with push on, in
     * one write. Nothing when there are no events and nothing changed.
     */
    commit(events = []) {
      if (events.length === 0 && revisions() === filed) return;
      write(events);
    },
    /** Write the state now, with no notices (a migration). */
    save() {
      write([]);
    },
  };
}

/**
 * The poller's state and its commit: `{ stateStore, heldBackStore, notices }`.
 *
 * @param {object} deps
 * @param {object} deps.snapshot  the push snapshot (createPushSnapshot)
 * @param {{ wake: () => void }} deps.sender  its sender (push/outbox.js)
 * @param {() => boolean} deps.isPushEnabled
 * @param {string} deps.dir  the data directory, where the old files are
 * @param {object} [deps.logger]
 */
export function openPollerState({ snapshot, sender, isPushEnabled, dir, logger = defaultLog }) {
  const { state, from } = startingState({
    snapshot,
    name: POLLER,
    dir,
    files: { state: OLD_FILES.state, heldBack: OLD_FILES.heldBack },
  });
  const stateStore = createArcaneStateStore({ initial: state.state });
  const heldBackStore = createHeldBackStore({ initial: state.heldBack });
  const notices = createCommit({
    name: POLLER,
    snapshot,
    sender,
    isPushEnabled,
    stores: [stateStore, heldBackStore],
    toState: () => ({ state: stateStore.toFile(), heldBack: heldBackStore.toFile() }),
    logger,
  });
  if (TAKEN[from]) {
    notices.save();
    logger.info({ from: [OLD_FILES.state, OLD_FILES.heldBack] }, `Arcane poller ${TAKEN[from]}`);
  }
  return { stateStore, heldBackStore, notices };
}

/**
 * The vulnerability digest's state and its commit: `{ stateStore, notices }`.
 * Deps as openPollerState's.
 */
export function openDigestState({ snapshot, sender, isPushEnabled, dir, logger = defaultLog }) {
  const { state, from } = startingState({
    snapshot,
    name: DIGEST,
    dir,
    files: { vulns: OLD_FILES.vulns },
  });
  const stateStore = createVulnStateStore({ initial: state.vulns });
  const notices = createCommit({
    name: DIGEST,
    snapshot,
    sender,
    isPushEnabled,
    stores: [stateStore],
    toState: () => ({ vulns: stateStore.toFile() }),
    logger,
  });
  if (TAKEN[from]) {
    notices.save();
    logger.info({ from: [OLD_FILES.vulns] }, `Arcane vulnerability digest ${TAKEN[from]}`);
  }
  return { stateStore, notices };
}
