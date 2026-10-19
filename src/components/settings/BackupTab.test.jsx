import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import BackupTab from './BackupTab.jsx';
import { ConfigProvider } from '../../context/ConfigContext.jsx';
import { OverlayProvider } from '../../context/OverlayContext.jsx';

// West of UTC the evening is already tomorrow in UTC, so a filename dated from
// toISOString() named the wrong day.
let savedTz;
beforeAll(() => {
  savedTz = process.env.TZ;
  process.env.TZ = 'America/Toronto';
});
afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});
afterEach(() => vi.useRealTimers());

describe('BackupTab export', () => {
  it('dates the file with the local day, not the UTC one', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 20, 21, 30)); // 01:30 UTC on Oct 21
    // jsdom has no object URLs; capture the download name from the anchor click.
    const RealURL = globalThis.URL;
    vi.stubGlobal(
      'URL',
      class extends RealURL {
        static createObjectURL() {
          return 'blob:x';
        }
        static revokeObjectURL() {}
      }
    );
    let downloaded;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
      downloaded = this.download;
    });

    render(
      <OverlayProvider>
        <ConfigProvider config={{ sections: {} }} setConfig={vi.fn()}>
          <BackupTab />
        </ConfigProvider>
      </OverlayProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export Config' }));

    expect(downloaded).toBe('jaghelm-config-2026-10-20.json');
  });
});
