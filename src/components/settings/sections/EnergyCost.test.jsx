/*
 * Settings → System → Energy cost (#743): the display config's `energy`,
 * saved only while every row and the symbol are valid, with each rule said
 * on the field it is about.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import EnergyCost from './EnergyCost.jsx';
import { ConfigProvider } from '../../../context/ConfigContext.jsx';

function Harness({ initial = {} }) {
  const [config, setConfig] = useState(initial);
  window.__display = config;
  return (
    <ConfigProvider config={config} setConfig={setConfig}>
      <EnergyCost />
    </ConfigProvider>
  );
}

const SAVED = {
  energy: {
    currency: '£',
    rates: [
      { from: '2026-01-01', perKwh: 0.14 },
      { from: '2026-06-01', perKwh: 0.2 },
    ],
  },
};
const rate = (n) => screen.getByRole('group', { name: `Rate ${n}` });
const from = (n) => within(rate(n)).getByLabelText('Effective from');
const price = (n) => within(rate(n)).getByLabelText(/^Price per kWh/);
const currency = () => screen.getByLabelText('Currency symbol');

describe('Energy cost', () => {
  it('with no rate says so, offers Add, and says the currency applies once a rate is added', () => {
    render(<Harness />);
    expect(screen.getByText(/No rates yet/)).toBeInTheDocument();
    expect(screen.getByText(/saved together with the first rate/)).toBeInTheDocument();
    expect(currency()).toHaveValue('$');
    expect(screen.getByRole('button', { name: /Add a rate/ })).toBeEnabled();
  });

  it('a currency typed with no rate is never saved', async () => {
    render(<Harness />);
    await userEvent.clear(currency());
    await userEvent.type(currency(), '£');
    expect(window.__display.energy).toBeUndefined();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the saved rows and labels the newest Current', () => {
    render(<Harness initial={SAVED} />);
    expect(currency()).toHaveValue('£');
    expect(from(1)).toHaveValue('2026-01-01');
    expect(price(2)).toHaveValue('0.2');
    expect(within(rate(2)).getByText('Current')).toBeInTheDocument();
    expect(within(rate(1)).queryByText('Current')).toBeNull();
  });

  it('a new row has a date and no price, and saves nothing until the price is valid', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: /Add a rate/ }));
    expect(from(1).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(price(1)).toHaveValue('');
    expect(window.__display.energy).toBeUndefined();
    await userEvent.type(price(1), '0.14');
    await userEvent.clear(currency());
    await userEvent.type(currency(), '€');
    expect(window.__display.energy).toEqual({
      currency: '€',
      rates: [{ from: from(1).value, perKwh: 0.14 }],
    });
  });

  it('a decimal typed with a comma is saved as a number', () => {
    render(<Harness initial={SAVED} />);
    fireEvent.change(price(1), { target: { value: '0,15' } });
    expect(window.__display.energy.rates[0]).toEqual({ from: '2026-01-01', perKwh: 0.15 });
  });

  it('a price typed with the symbol saves the number only', () => {
    render(<Harness initial={SAVED} />);
    fireEvent.change(price(1), { target: { value: '£ 0,25' } });
    expect(window.__display.energy.rates[0]).toEqual({ from: '2026-01-01', perKwh: 0.25 });
    fireEvent.change(price(1), { target: { value: '$0.30' } });
    expect(window.__display.energy.rates[0].perKwh).toBe(0.3);
    expect(window.__display.energy.currency).toBe('£');
  });

  it('a price typed into the symbol box points to the price box', () => {
    render(<Harness initial={SAVED} />);
    fireEvent.change(currency(), { target: { value: '$0.20' } });
    expect(currency()).toHaveAccessibleDescription(/symbol only, like \$\. Put the price/);
    expect(window.__display.energy.currency).toBe('£');
  });

  it('the symbol hint is short', () => {
    render(<Harness initial={SAVED} />);
    expect(screen.getByText('Just the symbol, such as $. Default $')).toBeInTheDocument();
  });

  it('a bad price is said on its field and the saved rates stay', () => {
    render(<Harness initial={SAVED} />);
    fireEvent.change(price(1), { target: { value: '11' } });
    expect(price(1)).toHaveAttribute('aria-invalid', 'true');
    expect(price(1)).toHaveAccessibleDescription(/at most 10 per kWh/);
    expect(screen.getByRole('status')).toHaveTextContent('Not saved yet');
    expect(window.__display.energy).toEqual(SAVED.energy);
    fireEvent.change(price(1), { target: { value: '0.15' } });
    expect(screen.queryByRole('status')).toBeNull();
    expect(window.__display.energy.rates[0].perKwh).toBe(0.15);
  });

  it('a date used twice is said on the later row and not saved', () => {
    render(<Harness initial={SAVED} />);
    fireEvent.change(from(2), { target: { value: '2026-01-01' } });
    expect(from(2)).toHaveAccessibleDescription(/already starts on this day/);
    expect(from(1)).not.toHaveAttribute('aria-invalid');
    expect(window.__display.energy).toEqual(SAVED.energy);
  });

  it('a symbol over three characters is said and not saved', () => {
    render(<Harness initial={SAVED} />);
    fireEvent.change(currency(), { target: { value: 'ABCD' } });
    expect(currency()).toHaveAccessibleDescription(/1 to 3 characters/);
    expect(window.__display.energy.currency).toBe('£');
  });

  it('removing a row saves the rest; removing the last clears the key', async () => {
    render(<Harness initial={SAVED} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove rate 2' }));
    expect(window.__display.energy.rates).toEqual([{ from: '2026-01-01', perKwh: 0.14 }]);
    expect(within(rate(1)).getByText('Current')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove rate 1' }));
    expect(window.__display.energy).toBeUndefined();
    expect(screen.getByText(/No rates yet/)).toBeInTheDocument();
  });

  it('removing a row that was wrong clears its message', async () => {
    render(<Harness initial={SAVED} />);
    fireEvent.change(price(2), { target: { value: 'x' } });
    await userEvent.click(screen.getByRole('button', { name: 'Remove rate 2' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(window.__display.energy.rates).toHaveLength(1);
  });

  it('stops adding at 24 rates and says why', () => {
    const rates = Array.from({ length: 24 }, (_, i) => ({
      from: `2026-01-${String(i + 1).padStart(2, '0')}`,
      perKwh: 0.1,
    }));
    render(<Harness initial={{ energy: { currency: '$', rates } }} />);
    expect(screen.getByRole('button', { name: /Add a rate/ })).toBeDisabled();
    expect(screen.getByText(/At most 24 rates/)).toBeInTheDocument();
  });

  it('follows a change to the config from elsewhere', () => {
    function Swap() {
      const [config, setConfig] = useState({});
      return (
        <ConfigProvider config={config} setConfig={setConfig}>
          <button onClick={() => setConfig(SAVED)}>import</button>
          <EnergyCost />
        </ConfigProvider>
      );
    }
    render(<Swap />);
    fireEvent.click(screen.getByText('import'));
    expect(price(2)).toHaveValue('0.2');
  });
});
