/*
 * Settings → Nodes & Services → Backup freshness (#675): the two lines are the
 * display config's `backupAgeHours`, the preview follows them at once, and a
 * pair that makes no sense is said and not saved.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import BackupFreshness from './BackupFreshness.jsx';
import { ConfigProvider } from '../../../context/ConfigContext.jsx';

function Harness({ initial = {} }) {
  const [config, setConfig] = useState(initial);
  window.__display = config;
  return (
    <ConfigProvider config={config} setConfig={setConfig}>
      <BackupFreshness />
    </ConfigProvider>
  );
}

const amber = () => screen.getByLabelText('Amber from (hours since the last good run)');
const red = () => screen.getByLabelText('Red from (hours since the last good run)');
const states = () =>
  [...document.querySelectorAll('[data-slot="backup-age-preview"] li')].map((n) =>
    n.getAttribute('data-state')
  );
const previews = () =>
  [...document.querySelectorAll('[data-slot="backup-age-preview"] li')].map((n) => n.textContent);

describe('Backup freshness lines', () => {
  it('start at 36 and 72 hours on a config that has never saved them', () => {
    render(<Harness />);
    expect(amber()).toHaveValue(36);
    expect(red()).toHaveValue(72);
    expect(window.__display.backupAgeHours).toBeUndefined();
    expect(screen.getByRole('button', { name: /Reset to 36 and 72 hours/ })).toBeDisabled();
    expect(states()).toEqual(['ok', 'warn', 'crit']);
  });

  it('a valid change is saved at once and the preview follows it', async () => {
    render(<Harness />);
    await userEvent.clear(red());
    await userEvent.type(red(), '100');
    await userEvent.clear(amber());
    await userEvent.type(amber(), '50');
    expect(window.__display.backupAgeHours).toEqual({ warn: 50, crit: 100 });
    expect(previews().join(' ')).toMatch(/last good run 50 h ago/);
    expect(previews().join(' ')).toMatch(/last good run 100 h ago/);
  });

  it('red at or under amber is said, on the field last edited, and never saved', () => {
    render(<Harness initial={{ backupAgeHours: { warn: 36, crit: 72 } }} />);
    fireEvent.change(red(), { target: { value: '20' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Red has to be more hours than amber');
    expect(window.__display.backupAgeHours).toEqual({ warn: 36, crit: 72 });
    fireEvent.change(amber(), { target: { value: '30' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Amber has to be fewer hours than red');
  });

  it('a value that is not whole hours in range is said and never saved', () => {
    render(<Harness />);
    for (const bad of ['0', '9999', '1.5', '']) {
      fireEvent.change(amber(), { target: { value: bad } });
      expect(screen.getAllByRole('alert')[0]).toHaveTextContent(/Whole hours, 1 to 720/);
    }
    expect(window.__display.backupAgeHours).toBeUndefined();
  });

  it('Reset puts the defaults back', async () => {
    render(<Harness initial={{ backupAgeHours: { warn: 6, crit: 12 } }} />);
    expect(amber()).toHaveValue(6);
    await userEvent.click(screen.getByRole('button', { name: /Reset to 36 and 72 hours/ }));
    expect(window.__display.backupAgeHours).toBeUndefined();
    expect(amber()).toHaveValue(36);
  });

  it('a stored pair that is no pair reads as the defaults', () => {
    render(<Harness initial={{ backupAgeHours: { warn: 72, crit: 36 } }} />);
    expect(amber()).toHaveValue(36);
    expect(red()).toHaveValue(72);
  });
});
