// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const p = (rel) => fileURLToPath(new URL(rel, import.meta.url));

describe('android scaffold + secret hygiene', () => {
  it('android Gradle project exists', () => {
    expect(existsSync(p('./android/settings.gradle'))).toBe(true);
    expect(existsSync(p('./android/app/build.gradle'))).toBe(true);
  });
  it('ships placeholder-only templates (REPLACE_ME, no key material)', () => {
    for (const t of [
      './google-services.json.example',
      './keystore.properties.example',
      './.env.example',
    ]) {
      expect(existsSync(p(t))).toBe(true);
      const body = readFileSync(p(t), 'utf8');
      expect(body).toMatch(/REPLACE_ME/);
      expect(body).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
      expect(body).not.toMatch(/"private_key"\s*:\s*"-----/);
    }
  });
  it('does NOT commit real secrets', () => {
    expect(existsSync(p('./android/app/google-services.json'))).toBe(false);
    expect(existsSync(p('./keystore.properties'))).toBe(false);
  });
  it('mobile/.gitignore ignores secrets and negates templates', () => {
    const gi = readFileSync(p('./.gitignore'), 'utf8');
    expect(gi).toMatch(/google-services\.json/);
    expect(gi).toMatch(/keystore\.properties/);
    expect(gi).toMatch(/!\*\*\/\*\.example/);
  });
});
