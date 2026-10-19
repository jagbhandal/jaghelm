import { describe, it, expect, vi } from 'vitest';
import { uuidV4 } from './uuid.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidV4', () => {
  it('uses crypto.randomUUID when the context has it', () => {
    const randomUUID = vi.fn(() => '11111111-2222-4333-8444-555555555555');
    vi.stubGlobal('crypto', { randomUUID, getRandomValues: vi.fn() });
    expect(uuidV4()).toBe('11111111-2222-4333-8444-555555555555');
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  describe('without crypto.randomUUID (plain-HTTP origin)', () => {
    it('builds a UUID v4 from crypto.getRandomValues', () => {
      const real = globalThis.crypto;
      const getRandomValues = vi.fn((a) => real.getRandomValues(a));
      vi.stubGlobal('crypto', { getRandomValues });
      expect(uuidV4()).toMatch(UUID_V4);
      expect(getRandomValues).toHaveBeenCalledTimes(1);
    });

    it('sets the version and variant bits whatever the random bytes are', () => {
      vi.stubGlobal('crypto', { getRandomValues: (a) => a.fill(0xff) });
      expect(uuidV4()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
      vi.stubGlobal('crypto', { getRandomValues: (a) => a.fill(0x00) });
      expect(uuidV4()).toBe('00000000-0000-4000-8000-000000000000');
    });

    it('does not repeat across many calls', () => {
      const real = globalThis.crypto;
      vi.stubGlobal('crypto', { getRandomValues: (a) => real.getRandomValues(a) });
      const ids = new Set(Array.from({ length: 1000 }, () => uuidV4()));
      expect(ids.size).toBe(1000);
    });
  });
});
