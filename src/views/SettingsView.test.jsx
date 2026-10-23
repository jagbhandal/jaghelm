import { render, screen, fireEvent, act } from '@testing-library/react';
import { useState, useRef } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import SettingsView from './SettingsView';
import { ConfigProvider } from '../context/ConfigContext.jsx';
import { OverlayProvider } from '../context/OverlayContext.jsx';

// The `update(path, value)` deep-setter the sections drive lives in
// ConfigContext (computed once from the stable setConfig, immutable via setIn),
// not inside SettingsView. These tests pin the OBSERVABLE contract of `update`,
// driven through the real UI:
//   1. a nested path is set to the new value (correct deep-set), and
//   2. the previous config object is NOT mutated (immutability) — the property
//      that setIn preserves.
// We wrap SettingsView in a ConfigProvider seeded with the Harness's captured
// setConfig, open Settings → Appearance (the branding's title field and the
// Overview sections' switches) from the index, and drive its controls.
// Nodes & Services fetches the server's config, so fetch answers inertly.

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
// can assert it was never mutated by `update`. The captured setConfig is handed
// to ConfigProvider, which derives the `update` deep-setter the tabs consume.
function Harness({ initialConfig, onConfigs, section = 'appearance' }) {
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
  // SettingsView shows a refused save in a toast, so it sits in the overlay
  // provider, as in App.jsx.
  return (
    <OverlayProvider>
      <ConfigProvider config={config} setConfig={setConfig}>
        <SettingsView theme="dark" setTheme={() => {}} section={section} />
      </ConfigProvider>
    </OverlayProvider>
  );
}

// Flush the tabs' async fetch state updates so they
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
  overviewSections: { strip: false, jobs: true },
  ...overrides,
});

describe('SettingsView update() contract (guards the setIn swap)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(inertFetch));
  });

  it('sets a top-level field to the typed value', async () => {
    let captured = [];
    render(<Harness initialConfig={makeConfig()} onConfigs={(r) => (captured = r)} />);
    await flushAsync();

    const titleInput = screen.getByPlaceholderText('JAGHELM');
    fireEvent.change(titleInput, { target: { value: 'New Title' } });
    await flushAsync();

    const last = captured[captured.length - 1];
    expect(last.next.title).toBe('New Title');
    // input is controlled — the new value is reflected back into the field.
    expect(screen.getByPlaceholderText('JAGHELM')).toHaveValue('New Title');
  });

  it('does NOT mutate the previous config object (immutability)', async () => {
    const initial = makeConfig({ title: 'Original' });
    let captured = [];
    render(<Harness initialConfig={initial} onConfigs={(r) => (captured = r)} />);
    await flushAsync();

    fireEvent.change(screen.getByPlaceholderText('JAGHELM'), {
      target: { value: 'Changed' },
    });
    await flushAsync();

    const { prev, next } = captured[captured.length - 1];
    // New object identity...
    expect(next).not.toBe(prev);
    // ...and the previous reference is untouched (this is the property the
    // setIn clone provides today and setIn must preserve).
    expect(prev.title).toBe('Original');
    expect(next.title).toBe('Changed');
  });

  it('deep-sets a nested path without mutating the previous nested object', async () => {
    const initial = makeConfig();
    let captured = [];
    render(<Harness initialConfig={initial} onConfigs={(r) => (captured = r)} />);
    await flushAsync();

    // The Services switch maps to update('overviewSections.services', false).
    fireEvent.click(screen.getByRole('switch', { name: 'Services' }));
    await flushAsync();

    const { prev, next } = captured[captured.length - 1];
    expect(next.overviewSections.services).toBe(false);
    // Sibling keys on the nested object are preserved.
    expect(next.overviewSections.strip).toBe(false);
    expect(next.overviewSections.jobs).toBe(true);
    // The PREVIOUS nested object must not have been mutated in place.
    expect(prev.overviewSections).toEqual({ strip: false, jobs: true });
    expect(prev.overviewSections).not.toBe(next.overviewSections);
  });

  it('toggling a nested boolean sets only that leaf', async () => {
    const initial = makeConfig();
    let captured = [];
    render(<Harness initialConfig={initial} onConfigs={(r) => (captured = r)} />);
    await flushAsync();

    // The Checklist switch maps to update('sections.todos.visible', false).
    fireEvent.click(screen.getByRole('switch', { name: 'Checklist' }));
    await flushAsync();

    const { prev, next } = captured[captured.length - 1];
    expect(next.sections.todos.visible).toBe(false);
    expect(prev.sections).toEqual({});
    expect(next.overviewSections).toBe(prev.overviewSections);
  });
});

// #306: the live preview drew the old board, which is gone; changes apply to
// the Overview itself (spec §7, M10).
describe('SettingsView without the live preview', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(inertFetch));
  });

  it('offers no preview on any section, nor the old frame that held one', async () => {
    for (const section of [undefined, 'nodes', 'integrations', 'apps', 'appearance', 'system']) {
      const view = render(
        <Harness initialConfig={makeConfig()} onConfigs={() => {}} section={section} />
      );
      await flushAsync();
      expect(screen.queryByRole('button', { name: /preview/i })).toBeNull();
      expect(screen.queryByText(/LIVE PREVIEW/i)).toBeNull();
      expect(
        document.querySelector('.settings-main, .settings-page, .settings-preview')
      ).toBeNull();
      view.unmount();
    }
  });
});
