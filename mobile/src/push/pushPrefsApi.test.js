import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted() so the mock fns are safely referenced inside the hoisted vi.mock
// factories (the repo convention — see connect.test.js — avoids the TDZ trap).
const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
const { getApiBase } = vi.hoisted(() => ({ getApiBase: vi.fn(() => 'http://vm-101:3099/api') }));
vi.mock('@shared/api/client.js', () => ({ apiFetch }));
vi.mock('@shared/api/baseUrl.js', () => ({ getApiBase }));

import {
  getPushStatus, getPushPrefs, setPushPrefs, registerToken, deleteToken,
} from './pushPrefsApi.js';

const PREFS = {
  categories: { service: true, host: true, ups: true, cron: true, watchtower: true },
  notifyRecoveries: true,
  enabled: true,
};

const okJson = (body) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  apiFetch.mockReset();
  getApiBase.mockReset().mockReturnValue('http://vm-101:3099/api');
});

describe('pushPrefsApi', () => {
  it('getPushStatus GETs /push/status and returns the body', async () => {
    apiFetch.mockResolvedValue(okJson({ enabled: false }));
    const r = await getPushStatus();
    expect(apiFetch).toHaveBeenCalledWith('http://vm-101:3099/api/push/status');
    expect(r).toEqual({ enabled: false });
  });

  it('getPushPrefs encodes the FCM token in the query and returns body.prefs', async () => {
    apiFetch.mockResolvedValue(okJson({ prefs: PREFS }));
    const r = await getPushPrefs('fcm tok/+=');
    expect(apiFetch).toHaveBeenCalledWith(
      'http://vm-101:3099/api/push/prefs?token=fcm%20tok%2F%2B%3D',
    );
    expect(r).toEqual(PREFS);
  });

  it('setPushPrefs PUTs the full {token, prefs} body and returns body.prefs', async () => {
    apiFetch.mockResolvedValue(okJson({ prefs: PREFS }));
    const r = await setPushPrefs('fcmtok', PREFS);
    expect(apiFetch).toHaveBeenCalledWith('http://vm-101:3099/api/push/prefs', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'fcmtok', prefs: PREFS }),
    });
    expect(r).toEqual(PREFS);
  });

  it('registerToken POSTs token+platform+appVersion', async () => {
    apiFetch.mockResolvedValue(okJson({ stored: true, deliveryEnabled: false }));
    const r = await registerToken('fcmtok');
    const [url, opts] = apiFetch.mock.calls[0];
    expect(url).toBe('http://vm-101:3099/api/push/register');
    expect(opts.method).toBe('POST');
    const sent = JSON.parse(opts.body);
    expect(sent.token).toBe('fcmtok');
    expect(sent.platform).toBe('android');
    expect(typeof sent.appVersion).toBe('string');
    expect(r).toEqual({ stored: true, deliveryEnabled: false });
  });

  it('deleteToken DELETEs with the token in the JSON body', async () => {
    apiFetch.mockResolvedValue(okJson({ removed: true }));
    const r = await deleteToken('fcmtok');
    expect(apiFetch).toHaveBeenCalledWith('http://vm-101:3099/api/push/register', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'fcmtok' }),
    });
    expect(r).toEqual({ removed: true });
  });

  it('throws on a non-2xx response AND surfaces the server error message', async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'malformed prefs' }) });
    await expect(setPushPrefs('fcmtok', PREFS)).rejects.toThrow(/400.*malformed prefs/);
    apiFetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'token not found' }) });
    try {
      await setPushPrefs('fcmtok', PREFS);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e.status).toBe(404);
      expect(e.serverMessage).toBe('token not found');
    }
  });
});
