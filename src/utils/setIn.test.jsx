import { setIn } from './setIn.js';

// .jsx extension keeps this in Vitest's lane (node:test only globs *.test.js).
describe('setIn', () => {
  it('sets a top-level key without mutating the input', () => {
    const before = { a: 1, b: 2 };
    const after = setIn(before, 'a', 9);
    expect(after).toEqual({ a: 9, b: 2 });
    expect(before).toEqual({ a: 1, b: 2 }); // input untouched
    expect(after).not.toBe(before);
  });

  it('sets a nested dotted path and creates missing intermediates', () => {
    const before = { display: { theme: 'light' } };
    const after = setIn(before, 'display.layout.cols', 12);
    expect(after.display.layout.cols).toBe(12);
    expect(after.display.theme).toBe('light');
    expect(before).toEqual({ display: { theme: 'light' } });
  });

  it('preserves identity of untouched sibling branches (structural sharing)', () => {
    const before = { display: { theme: 'light' }, links: { a: [1] } };
    const after = setIn(before, 'display.theme', 'dark');
    expect(after.links).toBe(before.links); // untouched branch keeps its ref
    expect(after.display).not.toBe(before.display); // path node is cloned
  });

  it('clones arrays as arrays when a numeric key is on the path', () => {
    const before = { tabs: [{ label: 'a' }, { label: 'b' }] };
    const after = setIn(before, ['tabs', 1, 'label'], 'B');
    expect(Array.isArray(after.tabs)).toBe(true);
    expect(after.tabs[1].label).toBe('B');
    expect(after.tabs[0]).toBe(before.tabs[0]); // unchanged element shared
    expect(before.tabs[1].label).toBe('b'); // input untouched
  });
});
