import { describe, it, expect } from 'vitest';
import {
  focusAfterForget,
  forgetDescription,
  forgetError,
  forgetTarget,
  forgotText,
} from './forgetMissing.js';

// A missing container's Remove (#688): who gets one, what the confirm says, what a refusal says.

const ENTITY = { id: 'services/vm103:wikijs', kind: 'container', node: 'vm103', name: 'Wikijs', word: 'Missing' };
const CARD = { uid: 'vm103:wikijs', container: 'wikijs', display_name: 'Wikijs', source: 'presence' };

describe('forgetTarget', () => {
  it('a Missing container drawn from a presence card gets one', () => {
    expect(forgetTarget(ENTITY, CARD)).toEqual({
      id: 'services/vm103:wikijs',
      node: 'vm103',
      container: 'wikijs',
      name: 'Wikijs',
      mapped: null,
      kuma: null,
    });
  });

  it('nothing else does: running, red monitor, other words, no card, no node', () => {
    expect(forgetTarget({ ...ENTITY, word: 'Running' }, CARD)).toBeNull();
    expect(forgetTarget({ ...ENTITY, word: 'Down' }, { ...CARD, source: 'monitor' })).toBeNull();
    expect(forgetTarget(ENTITY, { ...CARD, source: 'container' })).toBeNull();
    expect(forgetTarget(ENTITY, null)).toBeNull();
    expect(forgetTarget(ENTITY, { ...CARD, container: undefined })).toBeNull();
    expect(forgetTarget({ ...ENTITY, node: undefined }, CARD)).toBeNull();
    expect(forgetTarget(null, CARD)).toBeNull();
    // A stack's lead is drawn as the stack: its members carry Remove.
    expect(forgetTarget({ ...ENTITY, stack: { members: [] } }, CARD)).toBeNull();
  });

  it('keeps the monitor names that still name it', () => {
    const t = forgetTarget(ENTITY, { ...CARD, mapped: 'Quartz Notes', kuma: 'Quartz Notes' });
    expect(t.mapped).toBe('Quartz Notes');
    expect(t.kuma).toBe('Quartz Notes');
  });
});

describe('the words', () => {
  const t = forgetTarget(ENTITY, CARD);

  it('the confirm says what it does, and that it comes back', () => {
    expect(forgetDescription(t)).toBe(
      'Forget Wikijs on vm103. It comes back if the container returns.'
    );
  });

  it('a services.yaml mapping is mentioned and stays; else a Kuma monitor; services.yaml first', () => {
    expect(forgetDescription({ ...t, mapped: 'Quartz Notes', kuma: 'Quartz Notes' })).toBe(
      'Forget Wikijs on vm103. It comes back if the container returns. services.yaml still maps it to Kuma monitor "Quartz Notes"; that stays until you edit it.'
    );
    expect(forgetDescription({ ...t, kuma: 'Quartz Notes' })).toBe(
      'Forget Wikijs on vm103. It comes back if the container returns. Kuma monitor "Quartz Notes" still names it; Kuma is not changed.'
    );
  });

  it('each refusal says why, and that nothing was removed', () => {
    for (const [status, text] of [
      [403, 'dashboard password'],
      [404, 'no longer lists'],
      [409, 'running now'],
      [429, 'wait a minute'],
      [500, 'HTTP 500'],
    ]) {
      const e = forgetError('Wikijs', new Error(`HTTP ${status}`));
      expect(e.title).toBe("Couldn't remove Wikijs");
      expect(e.cause).toContain(text);
      expect(e.cause).toContain('Nothing was removed.');
    }
    expect(forgetError('Wikijs', new TypeError('Failed to fetch')).cause).toBe(
      "JagHelm couldn't be reached. Nothing was removed."
    );
  });

  it('the toast', () => {
    expect(forgotText(t)).toBe('Removed Wikijs on vm103. It comes back if the container returns.');
  });
});

describe('focusAfterForget', () => {
  const list = (ids) => {
    document.body.innerHTML = `<ul>${ids.map((id) => `<li><a href="#" data-entity="${id}">${id}</a></li>`).join('')}</ul>`;
  };

  it('goes to the next row, else the one before, else nothing', () => {
    list(['a', 'b', 'c']);
    expect(focusAfterForget('b').getAttribute('data-entity')).toBe('c');
    expect(focusAfterForget('c').getAttribute('data-entity')).toBe('b');
    list(['a']);
    expect(focusAfterForget('a')).toBeNull();
    expect(focusAfterForget('nope')).toBeNull();
  });

  it('ignores the row inside the open drawer', () => {
    document.body.innerHTML =
      '<ul><li><a data-entity="a">a</a></li><li><a data-entity="b">b</a></li></ul><div role="dialog"><div data-entity="a"></div></div>';
    expect(focusAfterForget('a').getAttribute('data-entity')).toBe('b');
  });
});
