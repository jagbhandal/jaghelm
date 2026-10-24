/*
 * Settings → Nodes & Services → Disk forecast (#670): the two lines are the
 * display config's `diskForecastDays`, the preview and the nodes read them
 * at once, and a pair that makes no sense is said and not saved.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import DiskForecast from './DiskForecast.jsx';
import { ConfigProvider } from '../../../context/ConfigContext.jsx';

function Harness({ initial = {} }) {
  const [config, setConfig] = useState(initial);
  window.__display = config;
  return (
    <ConfigProvider config={config} setConfig={setConfig}>
      <DiskForecast />
    </ConfigProvider>
  );
}

const amber = () => screen.getByLabelText('Amber under (days left)');
const red = () => screen.getByLabelText('Red under (days left)');
const states = () =>
  [...document.querySelectorAll('[data-slot="forecast-preview"] [data-slot="meter-note"]')].map(
    (n) => n.getAttribute('data-state')
  );

describe('Disk forecast lines', () => {
  it('start at 14 and 3 days on a config that has never saved them', () => {
    render(<Harness />);
    expect(amber()).toHaveValue(14);
    expect(red()).toHaveValue(3);
    expect(window.__display.diskForecastDays).toBeUndefined();
    expect(screen.getByRole('button', { name: /Reset to 14 and 3 days/ })).toBeDisabled();
  });

  it('a valid change is saved at once and the preview follows it', async () => {
    render(<Harness />);
    expect(states()).toEqual(['ok', 'warn', 'crit']);
    await userEvent.clear(amber());
    await userEvent.type(amber(), '30');
    await userEvent.clear(red());
    await userEvent.type(red(), '10');
    expect(window.__display.diskForecastDays).toEqual({ warn: 30, crit: 10 });
    expect(screen.getAllByText('30 days left')).not.toHaveLength(0);
    expect(screen.getAllByText('10 days left')).not.toHaveLength(0);
  });

  it('red at or over amber is said and never saved', async () => {
    render(<Harness initial={{ diskForecastDays: { warn: 14, crit: 3 } }} />);
    fireEvent.change(red(), { target: { value: '20' } });
    expect(screen.getByRole('alert')).toHaveTextContent('fewer days than the amber line');
    expect(window.__display.diskForecastDays).toEqual({ warn: 14, crit: 3 });
  });

  it('not a whole number of days is said and never saved', async () => {
    render(<Harness />);
    await userEvent.clear(amber());
    await userEvent.type(amber(), '0');
    expect(screen.getByRole('alert')).toHaveTextContent('whole number of days');
    expect(window.__display.diskForecastDays).toBeUndefined();
  });

  it('reset goes back to the defaults by dropping the saved pair', async () => {
    render(<Harness initial={{ diskForecastDays: { warn: 30, crit: 10 } }} />);
    expect(amber()).toHaveValue(30);
    await userEvent.click(screen.getByRole('button', { name: /Reset to 14 and 3 days/ }));
    expect(window.__display.diskForecastDays).toBeUndefined();
    expect(amber()).toHaveValue(14);
  });
});
