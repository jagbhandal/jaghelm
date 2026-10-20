import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { OverlayProvider } from '../../../context/OverlayContext.jsx';
import { useIntegrationActions } from './useIntegrationActions.js';

// #459: a successful save calls onAfterSave 800 ms later, so the "Saved" state
// shows first. A tab closed within those 800 ms must not get the call: it ran
// on an unmounted tab, and once fired after the test environment was torn
// down ("window is not defined"), failing CI on an unrelated PR.

vi.mock('../../../api/client.js', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) })),
}));

const FORM = {
  url: 'http://adguard.example.com',
  enabled: true,
  instance: '',
  target: '',
  username: '',
  password: '',
  token: '',
  params: {},
};

function setup(onAfterSave) {
  return renderHook(
    () =>
      useIntegrationActions({
        selectedPreset: { type: 'adguard' },
        editingType: null,
        form: FORM,
        refetch: () => {},
        onAfterSave,
      }),
    { wrapper: OverlayProvider }
  );
}

describe('useIntegrationActions: the post-save call (#459)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('calls onAfterSave 800 ms after a successful save', async () => {
    const onAfterSave = vi.fn();
    const { result } = setup(onAfterSave);
    await act(() => result.current.handleSave());
    expect(result.current.saveStatus).toBe('saved');
    act(() => vi.advanceTimersByTime(799));
    expect(onAfterSave).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onAfterSave).toHaveBeenCalledTimes(1);
  });

  it('never calls onAfterSave once the tab has unmounted', async () => {
    const onAfterSave = vi.fn();
    const { result, unmount } = setup(onAfterSave);
    await act(() => result.current.handleSave());
    unmount();
    vi.advanceTimersByTime(1000);
    expect(onAfterSave).not.toHaveBeenCalled();
  });

  it('a second save within 800 ms calls onAfterSave once', async () => {
    const onAfterSave = vi.fn();
    const { result } = setup(onAfterSave);
    await act(() => result.current.handleSave());
    act(() => vi.advanceTimersByTime(400));
    await act(() => result.current.handleSave());
    act(() => vi.advanceTimersByTime(1000));
    expect(onAfterSave).toHaveBeenCalledTimes(1);
  });
});
