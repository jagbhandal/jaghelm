/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cfg = readFileSync(
  fileURLToPath(new URL('./capacitor.config.ts', import.meta.url)),
  'utf8'
);

const appGradle = readFileSync(
  fileURLToPath(new URL('./android/app/build.gradle', import.meta.url)),
  'utf8'
);

describe('capacitor.config.ts (cap-config lint — mirrors check.yml)', () => {
  it("appId is io.jaghelm.app (must equal the Firebase package name)", () => {
    expect(cfg).toMatch(/appId:\s*'io\.jaghelm\.app'/);
  });
  it('webDir is dist', () => {
    expect(cfg).toMatch(/webDir:\s*'dist'/);
  });
  it('androidScheme is https (explicit — default is http)', () => {
    expect(cfg).toMatch(/androidScheme:\s*'https'/);
  });
  it('enables CapacitorHttp (native transport default)', () => {
    expect(cfg).toMatch(/CapacitorHttp:\s*{\s*enabled:\s*true/);
  });
  it('NEVER sets server.url (live-reload escape hatch)', () => {
    expect(cfg).not.toMatch(/\burl:\s*'/);
  });
  it('does NOT enable cleartext', () => {
    expect(cfg).not.toMatch(/cleartext:\s*true/);
  });
});

describe('android package identity (one canonical app id across the build)', () => {
  // build.gradle applicationId MUST equal capacitor appId AND the Firebase package_name
  // baked into google-services.json. The release workflow (.github/workflows/build-apk.yml)
  // asserts the injected google-services.json carries this exact package; pinning it here
  // turns a package rename into a fast unit-test failure instead of a failed release build.
  it('build.gradle applicationId is io.jaghelm.app', () => {
    expect(appGradle).toMatch(/applicationId\s+"io\.jaghelm\.app"/);
  });
});
