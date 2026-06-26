// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(
  fileURLToPath(new URL('./index.html', import.meta.url)),
  'utf8'
);
const fontsCss = readFileSync(
  fileURLToPath(new URL('./src/styles/fonts.css', import.meta.url)),
  'utf8'
);

describe('mobile index.html — tight CSP + local fonts', () => {
  it('has a CSP meta with connect-src self (native HTTP transport)', () => {
    expect(html).toMatch(/http-equiv="Content-Security-Policy"/);
    expect(html).toMatch(/connect-src 'self'/);
    expect(html).toMatch(/font-src 'self'/);
  });
  it('does NOT load fonts from a CDN', () => {
    expect(html).not.toMatch(/fonts\.googleapis\.com/);
    expect(html).not.toMatch(/fonts\.gstatic\.com/);
    expect(fontsCss).not.toMatch(/fonts\.googleapis\.com/);
    expect(fontsCss).not.toMatch(/fonts\.gstatic\.com/);
  });
  it('declares the three font families locally', () => {
    expect(fontsCss).toMatch(/font-family:\s*'Outfit'/);
    expect(fontsCss).toMatch(/font-family:\s*'DM Sans'/);
    expect(fontsCss).toMatch(/font-family:\s*'JetBrains Mono'/);
    expect(fontsCss).toMatch(/\.woff2/);
  });
});
