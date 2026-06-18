import { render, screen, fireEvent, act } from '@testing-library/react';
import { useState, useRef } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import SettingsView from './SettingsView';

// SettingsView's `update(path, value)` helper is THE thing the upcoming refactor
// changes: today it deep-sets immutably via JSON.parse(JSON.stringify(prev)), and
// that clone is to be replaced with immer. These tests pin the OBSERVABLE
// contract of `update`, driven through the real UI:
//   1. a nested path is set to the new value (correct deep-set), and
//   2. the previous config object is NOT mutated (immutability) — the property
//      that immer must also preserve.
// We render the General tab (simplest field-driven tab) which receives the real
// `update` callback SettingsView builds. SettingsView also renders a scaled
// DashboardView preview that fetches data, so we stub fetch to inert responses.

function inertFetch() {
  return Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () => Promise.resolve({}),
  });
}

// Controlled wrapper: holds config state like App.jsx does, captures every
// config reference React commits, and exposes the previous reference so the test
// can assert it was never mutated by `update`.
function Harness({ initialConfig, onConfigs }) {
  const [config, setConfigState] = useState(initialConfig);
  const refs = useRef([]);
  const setConfig = (updater) => {
    setConfigState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      refs.current.push({ prev, next });
      onConfigs?.(refs.current);
      return next;
    });
  };
  return <SettingsView config={config} setConfig={setConfig} theme="dark" setTheme={() => {}} />;
}

// Flush the embedded DashboardView preview's async fetch state updates so they
// settle inside act() rather than warning after the synchronous assertions.
async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const makeConfig = (overrides = {}) => ({
  title: 'JAGHELM',
  subtitle: 'Infra',
  showSearch: true,
  showWeather: false,
  tabs: [],
  sections: {},
  links: {},
  welcomeMessage: { enabled: false, text: 'hi', fontSize: 20 },
  ...overrides,
});

describe('SettingsView update() contract (guards the immer swap)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(inertFetch));
  });

  it('sets a top-level field to the typed value', async () => {
    let captured = [];
    render(<Harness initialConfig={makeConfig()} onConfigs={(r) => (captured = r)} />);
    await flushAsync();

    const titleInput = screen.getByPlaceholderText('JAG-NET');
    fireEvent.change(titleInput, { target: { value: 'New Title' } });
    await flushAsync();

    const last = captured[captured.length - 1];
    expect(last.next.title).toBe('New Title');
    // input is controlled — the new value is reflected back into the field.
    expect(screen.getByPlaceholderText('JAG-NET')).toHaveValue('New Title');
  });

  it('does NOT mutate the previous config object (immutability)', async () => {
    const initial = makeConfig({ title: 'Original' });
    let captured = [];
    render(<Harness initialConfig={initial} onConfigs={(r) => (captured = r)} />);
    await flushAsync();

    fireEvent.change(screen.getByPlaceholderText('JAG-NET'), {
      target: { value: 'Changed' },
    });
    await flushAsync();

    const { prev, next } = captured[captured.length - 1];
    // New object identity...
    expect(next).not.toBe(prev);
    // ...and the previous reference is untouched (this is the property the
    // JSON.parse(JSON.stringify) clone provides today and immer must preserve).
    expect(prev.title).toBe('Original');
    expect(next.title).toBe('Changed');
  });

  it('deep-sets a nested path without mutating the previous nested object', async () => {
    const initial = makeConfig({
      welcomeMessage: { enabled: false, text: 'original', fontSize: 20 },
    });
    let captured = [];
    render(<Harness initialConfig={initial} onConfigs={(r) => (captured = r)} />);
    await flushAsync();

    // The "Message Text" field maps to update('welcomeMessage.text', ...).
    fireEvent.change(screen.getByPlaceholderText('Welcome to JagHelm'), {
      target: { value: 'updated text' },
    });
    await flushAsync();

    const { prev, next } = captured[captured.length - 1];
    expect(next.welcomeMessage.text).toBe('updated text');
    // Sibling keys on the nested object are preserved.
    expect(next.welcomeMessage.enabled).toBe(false);
    expect(next.welcomeMessage.fontSize).toBe(20);
    // The PREVIOUS nested object must not have been mutated in place.
    expect(prev.welcomeMessage.text).toBe('original');
    expect(prev.welcomeMessage).not.toBe(next.welcomeMessage);
  });

  it('toggling a nested boolean sets only that leaf', async () => {
    const initial = makeConfig({
      welcomeMessage: { enabled: false, text: 'hi', fontSize: 20 },
    });
    let captured = [];
    render(<Harness initialConfig={initial} onConfigs={(r) => (captured = r)} />);
    await flushAsync();

    // The "Enabled" checkbox maps to update('welcomeMessage.enabled', true).
    const enabledCheckbox = screen.getByRole('checkbox', { name: /enabled/i });
    fireEvent.click(enabledCheckbox);
    await flushAsync();

    const { prev, next } = captured[captured.length - 1];
    expect(next.welcomeMessage.enabled).toBe(true);
    expect(prev.welcomeMessage.enabled).toBe(false);
    expect(next.welcomeMessage.text).toBe('hi');
  });
});
