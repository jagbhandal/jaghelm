# ADR 0002 — Single-instance, in-memory state (no database)

**Status:** accepted; amended 2026-10-23 (#250): sessions are kept on disk; note 2026-10-23 (#267): the alert history is too; note 2026-10-23 (#312): the heartbeat strips stay in memory

## Context

JagHelm is a personal homelab dashboard for one operator. Its data is small (a
config file, a warm cache of metrics, a handful of sessions). The deployment is a
single Docker container.

## Decision

Keep runtime state **in memory** (response cache, refresh-loop state,
rate-limiter buckets) and persist the user config/secrets to files (ADR 0001).
Sessions are the one piece of runtime state also kept in a file (see the
amendment below). Do **not** introduce a database or a shared cache. Run as a
**single instance**.

## Consequences

- Drastically simpler: no DB to run, migrate, back up, or secure; no ORM.
- A restart clears the cache (re-warmed by the background refresh loop within one
  cycle). Sessions survive it (#250).
- Signing out deletes that one session from the store and from
  `sessions.json` before the route answers (`POST /api/auth/logout`, #507);
  deletion is the revocation, so no deny list is kept.
- **Horizontal scaling is out of scope**: two instances would not share sessions,
  cache, or the rate-limiter's global counter, and both would write the same
  files (each would overwrite the other's `sessions.json`). The bounded in-memory
  maps (cache, limiter, sessions) have size caps so a single instance can't be
  memory-exhausted, but the design assumes one replica.
- Documented as a known constraint in KNOWN-ISSUES.md.

## Amendment (#250): sessions survive a restart

**Why.** Every restart signed out the web app and the phone, and every deploy
is a restart (22 in 24 hours at the 2026-10-18 audit). Losing the cache costs
one refresh cycle; losing the sessions costs a sign-in on every device. A
session also ended 24 hours after sign-in however much it was used. Jag decided
on 2026-10-18 that sessions survive restarts (spec §2).

**Store.** `auth/sessions.js` keeps each session in memory and in
`DATA_DIR/sessions.json`, written atomically and `0600` (ADR 0001). The file
holds the **SHA-256 of each token, never the token**, with
`{ user, created, lastUsed }`, plus a credential stamp (below). A token is 32
random bytes: with 256 bits there is nothing to guess, so a fast hash with no
salt or KDF is right, and a copy of the file (a backup) signs nobody in. A
lookup hashes the presented token and finds the digest in a map, so the
comparison's timing depends on digests the caller can't steer and tells nothing
about a stored token. The file is read on first use (no boot step).

**Expiry.** Sliding: a session ends after `SESSION_IDLE_MS` (30 days) without
use, and in any case `SESSION_MAX_AGE_MS` (90 days) after sign-in. Every request
a session authenticates is a use. Expired sessions are dropped on lookup, when
the file is read, and by the hourly sweep. The numbers are a starting choice and
can change.

**Writes stay cheap.** A sign-in, a sign-out and a password change are written
before the route answers. A use moves `lastUsed` in memory and is written once it
is `LAST_USED_SAVE_MS` (an hour) past the one on disk, so a polling phone writes
the file about once an hour, not every poll. A crash loses at most that hour of
the idle window. Only an authenticated request can cause a write.

**Bounded.** At most `MAX_SESSIONS` (50) are kept; a sign-in past that ends the
least recently used session. A file holding more loads the 50 most recently used.

**Fails safe.** No file is no sessions. A file that can't be read or parsed is no
sessions and one warning that never quotes it (#504); an entry that isn't a
session (or is dated in the future) is dropped with one warning. A write that
fails is logged and never fails a sign-in (no 500 for a full disk): the
sessions in memory carry on, and the next restart starts from the file as last
written, so a session made meanwhile ends then. A sign-out or password change
whose write fails removes the file instead, so a restart can't bring a revoked
session back: every device signs in again. If the file can be neither written
nor removed (a read-only disk), the sign-out answers **503**, not success: the
session has ended in memory, but a restart would bring it back, so the client
sends the sign-out again (the Android app keeps it, #539) and each retry writes
again until one goes through. Every write also fsyncs the directory after the
rename (ADR 0001), so a power cut just after a sign-out can't undo it.

**Revocation, unchanged in meaning.** Sign-out deletes the stored entry; a
password change in Settings deletes every other session; both are written
before the answer. A restart used to revoke everything, which covered a password
changed in `.env`. The file now carries a stamp of the user and the password in
force (`credentialStamp()` in `auth/passwords.js`), and a restart that finds a
different one (`DASH_PASS` or `DASH_USER` changed, `auth.json` edited or
removed) starts with no sessions and empties the file. A password change in
Settings changes the stamp too, so it holds across a restart even when
`sessions.json` can't take the write; it answers success, since the password
did change.

The stamp keeps no password verifier at rest weaker than what is already
there, so its kind follows what the install has:

- **A password set in Settings:** SHA-256 of the user and `auth.json`'s scrypt
  hash. Without `auth.json` it tests no guess; with it, `auth.json` is the
  better target anyway.
- **`DASH_PASS` with a `DASH_SECRET`:** HMAC-SHA256 of the user and password
  under a key derived from `DASH_SECRET` for this alone (HKDF with its own
  label; never the secrets key). It is useless without `DASH_SECRET`, which
  lives in `.env`, not `data/`. The trade: rotating `DASH_SECRET` signs every
  device out. A `DASH_SECRET` shorter than 16 characters, or one of the
  documented example values, is no key.
- **`DASH_PASS` alone:** scrypt, as slow to guess from as `auth.json`'s hash;
  it is the one thing in `data/` derived from that password.

Moving between kinds (setting `DASH_SECRET` for the first time, say) signs every
device out once. To sign every device out without a password change: stop
JagHelm, delete `sessions.json`, start it.

**Clients.** Nothing in the web or Android app assumed a restart ends a
session; both handle a 401 the same way (#492). The phone retries an offline
sign-out for 30 days (#539), the same as the idle window: by then the session it
ended has expired anyway.

## Note (#267): the alert history is kept on disk

What push's differ works out each cycle (a service down, a disk over its
line, a recovery) was thrown away once sent, and never kept at all without
push set up. It is now kept 30 days, at most 1000 events, for
`GET /api/events` (`push/alertHistory.js`). It is not a database: it lives in
memory and in the push snapshot file, `push-snapshot.json`, under `history`,
written in the same atomic write that advances the snapshot and queues the
pushes (ADR 0001), so a crash neither loses an event nor records one twice.
That file is now written with push off too; push's own baseline in it moves
only while push is on, so the history never changes what a phone is sent. One instance, as above: two would
each write their own history over the other's.

## Note (#312): the heartbeat strips are kept in memory

Each Kuma monitor's last 50 checks, for its heartbeat strip
(`server/kumaBeats.js`), are runtime state like the cache: in memory, at most
50 per monitor Kuma lists now (a monitor Kuma drops is dropped too), never on
disk. Read from Kuma's status page, they are Kuma's own beats, read again
every cycle, so a restart loses nothing. Read from Kuma's `/metrics`, which
has only the latest state, JagHelm samples one a cycle, and a restart starts
the strip again: it fills over 50 cycles (25 minutes at the default 30 s).
