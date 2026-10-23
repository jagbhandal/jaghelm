import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PhonePlatform, usePhonePlatform } from '@shared/phone/platform.js';

// What the shared phone screens get from the app drawing them (#303,
// src/phone/platform.js): a wiring mistake fails as the screen mounts, never
// as an Open that does nothing.

function Opens() {
  const { openTarget } = usePhonePlatform();
  return (
    <button type="button" onClick={() => openTarget({ kind: 'service', url: 'https://h/a' })}>
      Open
    </button>
  );
}

// React reports a render error on the console before it throws; keep the run quiet.
const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {});

describe('PhonePlatform (#303)', () => {
  it('a value without an openTarget function fails as it mounts, even around a screen that opens nothing', () => {
    quiet();
    for (const value of [undefined, null, {}, { openTarget: 'https://h' }, { open: () => {} }]) {
      expect(
        () => render(<PhonePlatform value={value}><p>Overview</p></PhonePlatform>),
        JSON.stringify(value) ?? 'undefined'
      ).toThrow('A <PhonePlatform> needs a value with an openTarget(target) function');
    }
  });

  it('a screen drawn outside any PhonePlatform fails to draw, and says why', () => {
    quiet();
    expect(() => render(<Opens />)).toThrow('A phone screen is drawn outside a <PhonePlatform>');
  });

  it('a screen inside one opens through its openTarget', () => {
    const openTarget = vi.fn();
    render(<PhonePlatform value={{ openTarget }}><Opens /></PhonePlatform>);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(openTarget).toHaveBeenCalledWith({ kind: 'service', url: 'https://h/a' });
  });
});
