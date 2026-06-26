import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const { getServices, getUPSStatus, getCronStatus } = vi.hoisted(() => ({
  getServices: vi.fn(), getUPSStatus: vi.fn(), getCronStatus: vi.fn(),
}));
vi.mock('@shared/hooks/useData.js', () => ({ getServices, getUPSStatus, getCronStatus }));

import { useDashboard } from './useDashboard.js';

beforeEach(() => {
  getServices.mockResolvedValue({ nodes: { 'vm-101': { display_name: 'VM 101', metrics: {}, services: [] } } });
  getUPSStatus.mockResolvedValue({ status: 1 });
  getCronStatus.mockResolvedValue([]);
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
});
