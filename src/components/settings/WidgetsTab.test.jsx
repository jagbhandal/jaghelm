import { render, screen, fireEvent, act } from '@testing-library/react';
import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import WidgetsTab from './WidgetsTab';
import { ConfigProvider } from '../../context/ConfigContext.jsx';

// WidgetsTab keeps local DRAFT state for the lat/lon coordinate inputs (so it
// can show a validation error without committing garbage). The bug: the drafts
// seeded once at mount and never re-synced, so an external whole-config replace
// (Backup → Import) or reset left the inputs showing stale values while every
// other tab read config live. These tests lock in the re-sync: an external
// config change updates the input value when the field is NOT focused, and does
// NOT clobber the user's input while the field IS focused.

// Controlled wrapper so the test can swap config from "outside" the tab.
function Harness({ initialConfig }) {
  const [config, setConfigState] = useState(initialConfig);
  const setConfig = (updater) => {
    setConfigState((prev) => (typeof updater === 'function' ? updater(prev) : updater));
  };
  // Expose a setter on window so the test can drive an external replace.
  window.__setConfig = setConfig;
  return (
    <ConfigProvider config={config} setConfig={setConfig}>
      <WidgetsTab />
    </ConfigProvider>
  );
}

const baseConfig = (extra = {}) => ({
  title: 'JAGHELM',
  weatherLat: '39.88',
  weatherLon: '-83.09',
  ...extra,
});

describe('WidgetsTab coordinate drafts re-sync on external config change', () => {
  it('updates the lat/lon inputs when config is replaced and the field is unfocused', () => {
    render(<Harness initialConfig={baseConfig()} />);

    const latInput = screen.getByPlaceholderText('39.88');
    const lonInput = screen.getByPlaceholderText('-83.09');
    expect(latInput).toHaveValue('39.88');
    expect(lonInput).toHaveValue('-83.09');

    // Simulate a Backup → Import whole-config replace from outside the tab.
    act(() => {
      window.__setConfig(baseConfig({ weatherLat: '51.5074', weatherLon: '-0.1278' }));
    });

    // Drafts re-sync to the new persisted values (the bug left them stale).
    expect(latInput).toHaveValue('51.5074');
    expect(lonInput).toHaveValue('-0.1278');
  });

  it('does NOT clobber the latitude input while the user is editing it', () => {
    render(<Harness initialConfig={baseConfig()} />);
    const latInput = screen.getByPlaceholderText('39.88');

    // User focuses and types a partial value.
    fireEvent.focus(latInput);
    fireEvent.change(latInput, { target: { value: '12.3' } });
    expect(latInput).toHaveValue('12.3');

    // An external config change arrives mid-edit; the focused field must keep
    // the user's in-progress draft rather than snapping to the new config.
    act(() => {
      window.__setConfig(baseConfig({ weatherLat: '99.9' }));
    });
    expect(latInput).toHaveValue('12.3');

    // After blur, a subsequent external change re-syncs normally.
    fireEvent.blur(latInput);
    act(() => {
      window.__setConfig(baseConfig({ weatherLat: '45.0' }));
    });
    expect(latInput).toHaveValue('45.0');
  });
});
