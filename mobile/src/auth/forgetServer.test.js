import { describe, it, expect, vi } from 'vitest';

vi.mock('capacitor-secure-storage-plugin', () => ({
  SecureStoragePlugin: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
}));

import { clearSessionToken, forgetServer } from './forgetServer.js';
import { keystoreAdapter } from '../storage/keystoreAdapter.js';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';

// Every dependency records into one log, so the tests see the order across them.
function fakes({ store, failAt } = {}) {
  const log = [];
  const step = (name) => {
    log.push(name);
    if (name === failAt) throw new Error(`${name} failed`);
  };
  const deps = {
    secureStore: store ?? {
      removeItem: async (k) => step(`remove ${k}`),
    },
    setPref: async (k, v) => step(`pref ${k}=${v}`),
    setAuthToken: (t) => step(`memory token=${JSON.stringify(t)}`),
  };
  return { log, deps };
}

const FIVE_STEPS = [
  'remove jaghelm-token',
  'pref jaghelm-remember=false',
  'memory token=""',
  'remove jaghelm-base-url',
  'pref jaghelm-base-url-present=false',
];

describe('forgetServer', () => {
  it('runs the five steps in this order: token, keep-signed-in off, in-memory token, URL, URL breadcrumb', async () => {
    const { log, deps } = fakes();
    await forgetServer({ deps });
    expect(log).toEqual(FIVE_STEPS);
  });

  it('does not start a step until the previous storage write has finished', async () => {
    const log = [];
    const gates = [];
    const gated = (name) => {
      log.push(name);
      return new Promise((resolve) => gates.push(resolve));
    };
    const deps = {
      secureStore: { removeItem: (k) => gated(`remove ${k}`) },
      setPref: (k, v) => gated(`pref ${k}=${v}`),
      setAuthToken: (t) => log.push(`memory token=${JSON.stringify(t)}`),
    };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    const done = forgetServer({ deps });
    await settle();
    expect(log).toEqual(FIVE_STEPS.slice(0, 1));
    gates.shift()();
    await settle();
    expect(log).toEqual(FIVE_STEPS.slice(0, 2));
    gates.shift()();
    await settle();
    expect(log).toEqual(FIVE_STEPS.slice(0, 4)); // the in-memory clear is synchronous
    gates.shift()();
    await settle();
    expect(log).toEqual(FIVE_STEPS);
    gates.shift()();
    await expect(done).resolves.toBeUndefined();
  });

  it('calls onTokenCleared after the in-memory token is cleared and before the URL is removed', async () => {
    const { log, deps } = fakes();
    await forgetServer({ deps, onTokenCleared: () => log.push('onTokenCleared') });
    expect(log).toEqual([...FIVE_STEPS.slice(0, 3), 'onTokenCleared', ...FIVE_STEPS.slice(3)]);
  });

  // The adapter swallows a failed Keystore delete, so the token can survive the
  // delete silently. Keep-signed-in is still switched off, and boot drops the
  // token unconditionally when it is not 'true' (boot.js).
  it('still switches keep-signed-in off when the Keystore delete fails silently', async () => {
    vi.mocked(SecureStoragePlugin.remove).mockRejectedValue(new Error('keystore delete failed'));
    const { log, deps } = fakes({ store: keystoreAdapter });
    await expect(forgetServer({ deps })).resolves.toBeUndefined();
    expect(SecureStoragePlugin.remove).toHaveBeenCalledWith({ key: 'jaghelm-token' });
    expect(log).toEqual([
      'pref jaghelm-remember=false',
      'memory token=""',
      'pref jaghelm-base-url-present=false',
    ]);
  });

  // A step that throws stops the sequence: later steps do not run and the
  // caller gets the error (Change server shows "Something went wrong").
  it.each(FIVE_STEPS.map((name, i) => [name, i]))(
    'a throw at "%s" rejects and skips every later step',
    async (failAt, i) => {
      const onTokenCleared = vi.fn();
      const { log, deps } = fakes({ failAt });
      await expect(forgetServer({ deps, onTokenCleared })).rejects.toThrow(`${failAt} failed`);
      expect(log).toEqual(FIVE_STEPS.slice(0, i + 1));
      expect(onTokenCleared).toHaveBeenCalledTimes(i >= 3 ? 1 : 0);
    }
  );
});

describe('clearSessionToken', () => {
  it('runs the first three steps in order and keeps the server address', async () => {
    const { log, deps } = fakes();
    await clearSessionToken(deps);
    expect(log).toEqual(FIVE_STEPS.slice(0, 3));
  });

  it('a throw at the token delete rejects before keep-signed-in is touched', async () => {
    const { log, deps } = fakes({ failAt: 'remove jaghelm-token' });
    await expect(clearSessionToken(deps)).rejects.toThrow('remove jaghelm-token failed');
    expect(log).toEqual(['remove jaghelm-token']);
  });
});
