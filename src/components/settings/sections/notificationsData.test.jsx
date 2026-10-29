import { describe, expect, it } from 'vitest';

import { METRIC_WORDS } from './notificationsData.js';

describe('the threshold rows’ words', () => {
  it('every metric the server can send has a name and a hint, the drive lines too (#727)', () => {
    for (const metric of ['cpu', 'mem', 'disk', 'temp', 'nvmeTemp', 'sataTemp']) {
      expect(METRIC_WORDS[metric]?.label, metric).toBeTruthy();
      expect(METRIC_WORDS[metric]?.hint, metric).toBeTruthy();
    }
    expect(METRIC_WORDS.nvmeTemp.label).toBe('Drive temperature, NVMe');
    expect(METRIC_WORDS.sataTemp.label).toBe('Drive temperature, SATA');
  });
});
