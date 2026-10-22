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
 * serverUrl and sessionToken (the session that was ended, which the DELETE and
 * the revoke need) are kept only while one of those two is left, and are sent
 * to that server only, by those two requests. The record is written as the
 * requests go out and trimmed as they answer, so closing the app mid-sign-out
 * keeps it.
 *
 * It is retried at app start (boot), when the phone gets a connection while the
 * app runs (Capacitor Network), and before a sign-in or a push registration,
 * which wait for it. It is wiped once everything succeeds, on a 401 (that
 * session is already gone, so nothing is left to end), or after 30 days. One
 * record at most: a newer sign-out merges into it. Nothing here ever rejects.
 * Known limit: an app that is never opened again never retries.
 */
import { PushNotifications } from '@capacitor/push-notifications';
import { Network } from '@capacitor/network';
import { secureStore } from '@shared/storage/index.js';
import { revokeSession, SIGN_OUT_TIMEOUT_MS } from '@shared/api/client.js';
import { PENDING_CLEANUP_KEY } from '../runtimeConfig.js';
import { isPushConfigured } from '../push/pushConfig.js';
import { deleteTokenAs } from '../push/pushPrefsApi.js';

/** How long a record is kept before it is dropped unfinished. */
export const PENDING_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

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
async function isOnline() {
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
    // The phone's own step first: it needs no session, so a 401 below can't skip it.
    if (rec.unregister) rec = { ...rec, unregister: !(await deleteFcmToken()) };
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

/** App start: try now, and again whenever the phone gets a connection. */
export function startPendingCleanup() {
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
  return runPendingCleanup();
}

/** This sign-out's steps merged into the record there is (one record at most). */
function merge(old, mine) {
  const at = Date.now();
  if (!old) return { at, ...mine };
  const unregister = mine.unregister || old.unregister;
  if (!mine.pushToken && !mine.revoke) return { ...old, at, unregister };
  const same = old.serverUrl === mine.serverUrl && old.sessionToken === mine.sessionToken;
  if (!same) return { at, ...mine, unregister }; // an older session's leftovers give way
  return {
    at,
    ...mine,
    pushToken: mine.pushToken || old.pushToken,
    revoke: mine.revoke || old.revoke,
    unregister,
  };
}

/**
 * Keep what a sign-out or Turn off push started, and trim it as the answers
 * come in: `push` is unregisterPush's promise ({ deleted, unregistered }),
 * `revoked` revokeSession's (null when there is no revoke: Turn off push).
 * `serverUrl` and `sessionToken` are the session's, read before it was cleared.
 * The FCM token deletion counts as done only with a connection: the plugin
 * resolves before Firebase answers, so offline it can't say it failed.
 */
export function rememberCleanup({ serverUrl, sessionToken, pushToken, push, revoked = null }) {
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
      if (unregistered && (await isOnline())) rec = { ...rec, unregister: false };
      await save(rec);
    } catch (e) {
      console.warn('[cleanup] could not keep the sign-out:', e && e.message);
    }
  });
}

/**
 * Push is about to register again: a pending FCM token deletion would delete
 * the new token, and a pending DELETE on this same server could unregister it
 * (the token is the old one when its deletion never ran), so both go. A DELETE
 * on another server, and any revoke, stay.
 */
export function dropPushSteps(serverUrl) {
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
