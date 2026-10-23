import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    // Precondition: fails loudly if the Toronto zone didn't apply.
    expect(new Date(2026, 9, 20, 21, 30).toISOString().slice(0, 10)).toBe('2026-10-21');
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

// #317 review: "Choose File" was a label around a hidden input, which the
// keyboard can't reach. It is a button that opens the file picker.
describe('BackupTab import', () => {
  it('"Choose File" is a button the keyboard reaches, and it opens the file picker', async () => {
    const user = userEvent.setup();
    const picked = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function click() {
      picked.input = this;
    });
    render(
      <OverlayProvider>
        <ConfigProvider config={{ sections: {} }} setConfig={vi.fn()}>
          <BackupTab />
        </ConfigProvider>
      </OverlayProvider>
    );
    const choose = screen.getByRole('button', { name: 'Choose File' });
    // Tab reaches it after Export Config.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Export Config' })).toHaveFocus();
    await user.tab();
    expect(choose).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(picked).toHaveBeenCalledTimes(1);
    expect(picked.input).toHaveAttribute('type', 'file');
    expect(picked.input).toHaveAttribute('accept', '.json');
    await user.keyboard(' ');
    expect(picked).toHaveBeenCalledTimes(2);
  });
});
