// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ledger = readFileSync(
  fileURLToPath(new URL('../.harness-ledger.md', import.meta.url)),
  'utf8'
);

describe('harness ledger — Phase 2 captures', () => {
  it('records the Phase 2 mobile scaffold section', () => {
    expect(ledger).toMatch(/Phase 2/);
  });
  it('records the SDK-36 build + deferred AGP/Gradle version pin', () => {
    expect(ledger).toMatch(/SDK 36/);
    expect(ledger).toMatch(/Phase 6/);
  });
  it('records the CDN→local-font migration', () => {
    expect(ledger).toMatch(/bundles the three families locally/i);
    expect(ledger).toMatch(/font-src 'self'/);
  });
  it('records the deferred @shared → workspace-package ADR', () => {
    expect(ledger).toMatch(/@shared/);
    expect(ledger).toMatch(/workspace package/i);
  });
  it('states verification was DEBUG-only (release signing not verified)', () => {
    expect(ledger).toMatch(/app-debug\.apk/);
    expect(ledger).toMatch(/release signing/i);
  });
});
