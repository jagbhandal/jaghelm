import { describe, it, expect } from 'vitest';
import { TABS } from './TABS.js';

describe('locked mobile IA', () => {
  it('is exactly Overview / Services / Infra / Alerts in order', () => {
    expect(TABS.map((t) => t.id)).toEqual(['overview', 'services', 'infra', 'alerts']);
    expect(TABS.map((t) => t.label)).toEqual(['Overview', 'Services', 'Infra', 'Alerts']);
  });
});
