/**
 * Finishing a sign-out or a Turn off push that couldn't reach the server or
 * Firebase (#539). Log out and Forget this device send DELETE /push/register
 * and the session revoke, and delete the FCM token on the phone; Turn off push
 * does the first and the last. Offline, those fail, and without a retry the
 * server keeps the session live until it expires and keeps sending to a phone
 * that still has its FCM token.
 *
 * So one record lives in the Keystore, next to where the session token was:
 *   { at, serverUrl, sessionToken, pushToken, revoke, unregister }
 * pushToken is the FCM token whose DELETE is left ('' for none), revoke says
 * the revoke is left, unregister says the FCM token deletion is left.
 * serverUrl and sessionToken are the session's: the one a sign-out ended, or
 * for Turn off push a copy of the live one (that session stays). They are kept
 * only while the DELETE or the revoke is left, and are sent to that server
 * only, by those two requests. The record is written as the requests go out
 * and trimmed as they answer, so closing the app mid-sign-out keeps it.
 *
 * It is retried at app start (boot), when the phone gets a connection while the
 * app runs (Capacitor Network), and before a sign-in. It is wiped once
 * everything succeeds, on a 401 (that session is already gone, so nothing is
 * left to end), or 30 days after that session's first step was kept. One
 * record at most. Nothing here ever rejects.
 *
 * A push registration replaces the push steps: the FCM token deletion would
 * delete the new token, and a DELETE on the same server would remove it there.
 * So once one is coming in this run (a sign-in or a resumed session with push
 * wanted, or Turn on), no retry deletes the FCM token, and the registration
 * drops that deletion and its own server's DELETE before it registers
 * (supersedePush). The drop waits for a retry under way, so a DELETE that
 * retry sent finishes before the registration, never after it.
 * Known limits: an app that is never opened again never retries; Turn off and
 * then Turn on within the deletion's round trip can get the dying token back.
 */
import { PushNotifications } from '@capacitor/push-notifications';
import { Network } from '@capacitor/network';
import { secureStore } from '@shared/storage/index.js';
import { revokeSession, SIGN_OUT_TIMEOUT_MS } from '@shared/api/client.js';
import { PENDING_CLEANUP_KEY } from '../runtimeConfig.js';
import { isPushConfigured } from '../push/pushConfig.js';
import { deleteTokenAs } from '../push/pushPrefsApi.js';
import { pushWanted } from '../push/pushChoice.js';

/** How long a record is kept before it is dropped unfinished. */
export const PENDING_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** How long a sign-in waits for the cleanup of its own server. */
export const SIGN_IN_WAIT_MS = 5000;

// Whether push registers in this run: set by a sign-in or a resumed session
// with push wanted, and by the registration itself; cleared by a sign-out,
// Turn off push, a failed sign-in or a refused permission. While set, no retry
// deletes the FCM token: the registration replaces that step.
let registering = false;

/**
 * What an answer to DELETE /push/register means for the record: 'gone' (401,
 * the session is already over), 'failed' (5xx or no answer: try again later)
 * or 'done' (anything else; a 4xx won't change on a retry).
 */
export function outcomeOf(status) {
  if (status === 401) return 'gone';
  if (!(status >= 100) || status >= 500) return 'failed';
  return 'done';
}

// Every read-change-write of the record runs here, one at a time.
let queue = Promise.resolve();
function serial(job) {
  const run = queue.then(job);
  queue = run.catch(() => {});
  return run;
}

function parse(raw) {
  let r;
  try {
    r = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!r || typeof r !== 'object' || !Number.isFinite(r.at)) return null;
  const str = (v) => (typeof v === 'string' ? v : '');
  return {
    at: r.at,
    serverUrl: str(r.serverUrl),
    sessionToken: str(r.sessionToken),
    pushToken: str(r.pushToken),
    revoke: r.revoke === true,
    unregister: r.unregister === true,
  };
}

async function wipe() {
  try {
    await secureStore.removeItem(PENDING_CLEANUP_KEY);
  } catch (e) {
    console.warn('[cleanup] wipe failed:', e && e.message);
  }
}

/** The record, or null. A record that can't be read is wiped. */
async function read() {
  const raw = await secureStore.getItem(PENDING_CLEANUP_KEY);
  if (!raw) return null;
  const rec = parse(raw);
  if (!rec) await wipe();
  return rec;
}

/** Store what's left; the session goes once the server has nothing left to do. */
async function save(rec) {
  const server = !!(rec.pushToken || rec.revoke);
  const left = server ? rec : { ...rec, serverUrl: '', sessionToken: '' };
  if (!server && !left.unregister) return wipe();
  await secureStore.setItem(PENDING_CLEANUP_KEY, JSON.stringify(left));
}

/** Whether the phone has a connection. Unknown counts as yes: the requests find out. */
export async function isOnline() {
  try {
    const status = await Network.getStatus();
    return !status || status.connected !== false;
  } catch {
    return true;
  }
}

async function deleteFcmToken() {
  if (!isPushConfigured()) return true; // the plugin would crash a build without push
  try {
    await PushNotifications.unregister();
    return true;
  } catch (e) {
    console.warn('[cleanup] FCM token deletion failed:', e && e.message);
    return false;
  }
}

async function sendDelete({ serverUrl, sessionToken, pushToken }) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve('failed');
    }, SIGN_OUT_TIMEOUT_MS);
  });
  const request = deleteTokenAs({
    base: serverUrl,
    session: sessionToken,
    token: pushToken,
    signal: controller.signal,
  }).then(
    (r) => outcomeOf(r && r.status),
    () => 'failed',
  );
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function retry() {
  try {
    let rec = await read();
    if (!rec) return;
    if (Date.now() - rec.at > PENDING_MAX_AGE_MS) return await wipe();
    if (!(await isOnline())) return; // the connection listener comes back
    // The phone's own step first: it needs no session, so a 401 below can't
    // skip it. Not while push registers in this run: it would delete the new
    // token, and the registration drops it (supersedePush).
    if (rec.unregister && !registering) rec = { ...rec, unregister: !(await deleteFcmToken()) };
    if (rec.pushToken) {
      const outcome = await sendDelete(rec);
      if (outcome === 'gone') return await wipe();
      if (outcome === 'failed') return await save(rec); // unreachable: the revoke would be too
      rec = { ...rec, pushToken: '' };
    }
    if (rec.revoke) {
      const reached = await revokeSession(rec.sessionToken, { base: rec.serverUrl });
      rec = { ...rec, revoke: !reached };
    }
    await save(rec);
  } catch (e) {
    console.warn('[cleanup] retry failed:', e && e.message);
  }
}

let running = null;

/**
 * Try what the record has left, once. A call while a try is under way gets
 * that try. Resolves when it is over; never rejects.
 */
export function runPendingCleanup() {
  if (!running) {
    running = serial(retry).finally(() => {
      running = null;
    });
  }
  return running;
}

let watching = false;

/**
 * App start: try now, and again whenever the phone gets a connection.
 * `resumed`: a session resumes, so push registers next when it is wanted.
 */
export function startPendingCleanup({ resumed = false } = {}) {
  if (!watching) {
    watching = true;
    try {
      Promise.resolve(
        Network.addListener('networkStatusChange', (status) => {
          if (status && status.connected) runPendingCleanup();
        }),
      ).catch((e) => console.warn('[cleanup] no connection events:', e && e.message));
    } catch (e) {
      console.warn('[cleanup] no connection events:', e && e.message);
    }
  }
  return (resumed ? expectRegistration() : Promise.resolve()).then(runPendingCleanup);
}

/**
 * A sign-in or a resumed session: push registers next if it is wanted on this
 * phone (and built in), so from now on no retry deletes the FCM token.
 */
export async function expectRegistration() {
  registering = isPushConfigured() && (await pushWanted());
}

/** Nothing registers after all (the sign-in failed, the permission is off). */
export function noRegistration() {
  registering = false;
}

/**
 * Before a sign-in to `serverUrl`: push registers after it when wanted (see
 * expectRegistration), and what the record holds is tried. The sign-in waits
 * for that only when the record is for this same server, and at most
 * SIGN_IN_WAIT_MS; another server's cleanup is independent and runs alongside.
 * Never rejects.
 */
export async function beforeSignIn(serverUrl) {
  await expectRegistration();
  let rec = null;
  try {
    rec = parse(await secureStore.getItem(PENDING_CLEANUP_KEY));
  } catch {
    // the retry reads it again
  }
  const run = runPendingCleanup();
  if (!rec || rec.serverUrl !== serverUrl) return;
  let timer;
  const bound = new Promise((resolve) => {
    timer = setTimeout(resolve, SIGN_IN_WAIT_MS);
  });
  try {
    await Promise.race([run, bound]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * This sign-out's steps merged into the record there is (one record at most).
 * More steps of the same session keep the record's `at`, so its 30 days are
 * never extended; a newer session's steps replace an older session's (that
 * token is dropped) and start their own.
 */
function merge(old, mine) {
  const now = Date.now();
  if (!old) return { at: now, ...mine };
  const unregister = mine.unregister || old.unregister;
  if (!mine.pushToken && !mine.revoke) return { ...old, unregister };
  const same = old.serverUrl === mine.serverUrl && old.sessionToken === mine.sessionToken;
  if (!same) return { at: now, ...mine, unregister }; // an older session's leftovers give way
  return {
    ...mine,
    at: old.at,
    pushToken: mine.pushToken || old.pushToken,
    revoke: mine.revoke || old.revoke,
    unregister,
  };
}

/**
 * Keep what a sign-out or Turn off push started, and trim it as the answers
 * come in: `push` is unregisterPush's promise ({ deleted, unregistered }),
 * `revoked` revokeSession's (null when there is no revoke: Turn off push).
 * `serverUrl` and `sessionToken` are the session's, read before it was cleared
 * (Turn off push: the live one). `unregistered` counts the FCM token deletion
 * done only when the phone had a connection as it asked: the plugin resolves
 * before Firebase answers, so offline it can't say it failed. Nothing
 * registers after a sign-out or Turn off push until a sign-in or Turn on.
 */
export function rememberCleanup({ serverUrl, sessionToken, pushToken, push, revoked = null }) {
  registering = false;
  return serial(async () => {
    try {
      const mine = {
        serverUrl,
        sessionToken,
        pushToken: pushToken || '',
        revoke: revoked !== null,
        unregister: isPushConfigured(),
      };
      let rec = merge(await read(), mine);
      await save(rec);
      const [answered, reached] = await Promise.all([push, revoked === null ? true : revoked]);
      const { deleted, unregistered } = answered || {};
      if (rec.serverUrl === serverUrl && rec.sessionToken === sessionToken) {
        if (deleted === 'gone') rec = { ...rec, pushToken: '', revoke: false };
        else {
          if (deleted === 'done' && rec.pushToken === mine.pushToken) rec = { ...rec, pushToken: '' };
          if (mine.revoke && reached) rec = { ...rec, revoke: false };
        }
      }
      if (unregistered) rec = { ...rec, unregister: false };
      await save(rec);
    } catch (e) {
      console.warn('[cleanup] could not keep the sign-out:', e && e.message);
    }
  });
}

/**
 * Push registers with `serverUrl` now (initPush, after expectRegistration),
 * which replaces the record's FCM token deletion (it would delete the new
 * token) and that server's DELETE (the token is added there again), so both
 * go. Waits for a retry under way, so a DELETE it sent finishes first. A
 * DELETE on another server and any revoke stay.
 */
export function supersedePush(serverUrl) {
  return serial(async () => {
    try {
      const rec = await read();
      if (!rec) return;
      const pushToken = rec.serverUrl === serverUrl ? '' : rec.pushToken;
      if (pushToken === rec.pushToken && !rec.unregister) return;
      await save({ ...rec, pushToken, unregister: false });
    } catch (e) {
      console.warn('[cleanup] could not drop the push steps:', e && e.message);
    }
  });
}
