import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  createSession,
  getSession,
  deleteSession,
  deleteAllSessionsExcept,
  _resetAllSessions,
} from './sessions.js';

beforeEach(() => _resetAllSessions());

test('createSession returns a token whose session resolves to the user', () => {
  const token = createSession('admin');
  const entry = getSession(token);
  assert.ok(entry, 'session should exist');
  assert.equal(entry.user, 'admin');
});

test('getSession returns null for an unknown or empty token', () => {
  assert.equal(getSession('nope'), null);
  assert.equal(getSession(''), null);
  assert.equal(getSession(undefined), null);
});

test('deleteSession removes a single session and reports whether it existed', () => {
  const token = createSession('admin');
  assert.equal(deleteSession(token), true, 'removing an existing token returns true');
  assert.equal(getSession(token), null);
  assert.equal(deleteSession(token), false, 'removing again returns false');
});

test('deleteAllSessionsExcept keeps only the supplied token', () => {
  const keep = createSession('admin');
  const a = createSession('admin');
  const b = createSession('admin');
  deleteAllSessionsExcept(keep);
  assert.ok(getSession(keep), 'kept session survives');
  assert.equal(getSession(a), null);
  assert.equal(getSession(b), null);
});

test('_resetAllSessions isolates state between cases', () => {
  // beforeEach already cleared; the store should be empty at the top of a case.
  const token = createSession('admin');
  assert.ok(getSession(token));
  _resetAllSessions();
  assert.equal(getSession(token), null, 'reset drops all sessions');
});
