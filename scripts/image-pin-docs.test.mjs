// The image pin in the README and the quickstart compose file is the current
// release (docs/RELEASING.md, step 2 of the release steps). A release PR that
// bumps package.json but forgets them would send new users to an old image.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const PIN = /ghcr\.io\/jagbhandal\/jaghelm:([\w.-]+)/g;

/** The jaghelm image tags `text` pins that are not `version`. */
export function wrongPins(text, version) {
  return [...text.matchAll(PIN)].map((m) => m[1]).filter((tag) => tag !== version);
}

test('wrongPins finds a stale or floating tag', () => {
  assert.deepEqual(wrongPins('image: ghcr.io/jagbhandal/jaghelm:1.0.0', '1.0.1'), ['1.0.0']);
  assert.deepEqual(wrongPins('image: ghcr.io/jagbhandal/jaghelm:latest', '1.0.1'), ['latest']);
  assert.deepEqual(wrongPins('image: ghcr.io/jagbhandal/jaghelm:1.0.1', '1.0.1'), []);
});

for (const file of ['README.md', 'docs/examples/quickstart/compose.yaml']) {
  test(`${file} pins the image to package.json's version`, () => {
    const { version } = JSON.parse(read('package.json'));
    const text = read(file);
    assert.ok(text.includes('ghcr.io/jagbhandal/jaghelm:'), `${file} no longer pins the jaghelm image`);
    assert.deepEqual(wrongPins(text, version), [], `${file}: bump the pin to ${version}`);
  });
}
