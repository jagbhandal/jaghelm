import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ServiceDetail from './ServiceDetail.jsx';
import { PhonePlatform } from '../platform.js';
import { OverlayProvider } from '../../context/OverlayContext.jsx';
import { stackBoard, STACK_NOW } from '../../../server/testing/stackBoard.js';
import { webStatus } from '../../hooks/useStatus.js';

// The phone sheet's strip (#671): `data.extras.beatsHistory` reaches the heartbeats.
const UID = 'vm103:immich-redis';
const dataOf = (extras) => {
  const { status, services } = stackBoard({ now: STACK_NOW });
  return {
    status: webStatus(status),
    reach: 'ok',
    servicesBody: services,
    updated: { subscribe: () => () => {}, get: () => STACK_NOW },
    loading: false,
    error: null,
    freshness: { stale: false },
    extras,
  };
};
const checks = [{ state: 'ok', word: 'Up', time: STACK_NOW, ping: 5 }];

function sheet(extras) {
  render(
    <OverlayProvider>
      <PhonePlatform value={{ openTarget: vi.fn() }}>
        <ServiceDetail data={dataOf(extras)} nav={{ push: vi.fn(), pop: vi.fn() }} params={{ uid: UID }} />
      </PhonePlatform>
    </OverlayProvider>
  );
}

describe('ServiceDetail heartbeats (#671)', () => {
  it('a since-restart strip says so and writes the reason out', () => {
    sheet({ beats: checks, beatsHistory: 'since-restart' });
    expect(screen.getByText('history since restart')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="beat-history-why"]')).toBeTruthy();
  });

  it('a Kuma strip has neither', () => {
    sheet({ beats: checks, beatsHistory: 'kuma' });
    expect(screen.queryByText('history since restart')).toBeNull();
  });
});
