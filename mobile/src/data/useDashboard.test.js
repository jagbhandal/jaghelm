import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const { getServices, getUPSStatus, getCronStatus, getDisplayConfig } = vi.hoisted(() => ({
  getServices: vi.fn(), getUPSStatus: vi.fn(), getCronStatus: vi.fn(), getDisplayConfig: vi.fn(),
}));
vi.mock('@shared/hooks/useData.js', () => ({ getServices, getUPSStatus, getCronStatus, getDisplayConfig }));

import { useDashboard } from './useDashboard.js';

beforeEach(() => {
  getServices.mockResolvedValue({ nodes: { 'vm-101': { display_name: 'VM 101', metrics: {}, services: [] } } });
  getUPSStatus.mockResolvedValue({ status: 1 });
  getCronStatus.mockResolvedValue([]);
  // Real /api/display-config shape: top-level integer refreshInterval (seconds).
  getDisplayConfig.mockResolvedValue({ refreshInterval: 30 });
});

describe('useDashboard', () => {
  it('loads all three sources and exposes the bodies', async () => {
    const { result } = renderHook(() => useDashboard());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.servicesBody.nodes['vm-101'].display_name).toBe('VM 101');
    expect(result.current.ups.status).toBe(1);
    expect(result.current.error).toBeNull();
  });
  it('surfaces an error when the primary services fetch throws', async () => {
    getServices.mockRejectedValue(new Error('HTTP 500'));
    const { result } = renderHook(() => useDashboard());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
  });
  it('stamps lastUpdated on a successful refresh', async () => {
    const { result } = renderHook(() => useDashboard());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(typeof result.current.lastUpdated).toBe('number');
  });
  it('syncs the refresh cadence to the display-config refreshInterval', async () => {
    getDisplayConfig.mockResolvedValue({ refreshInterval: 45 });
    const { result } = renderHook(() => useDashboard());
    await waitFor(() => expect(result.current.intervalMs).toBe(45000));
  });
  it('falls back to the default cadence when display-config is unreadable', async () => {
    getDisplayConfig.mockRejectedValue(new Error('no config'));
    const { result } = renderHook(() => useDashboard());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.intervalMs).toBe(30000);
  });
});
