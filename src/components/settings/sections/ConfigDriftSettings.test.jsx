/*
 * Settings → Nodes & Services → Config drift (#674): the stale hours are the
 * display config's `driftStaleHours`, a valid change is saved at once, one that
 * is not whole hours in range is said and not saved, and reset clears the key.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import ConfigDriftSettings from './ConfigDriftSettings.jsx';
import { ConfigProvider } from '../../../context/ConfigContext.jsx';

function Harness({ initial = {} }) {
  const [config, setConfig] = useState(initial);
  window.__display = config;
  return (
    <ConfigProvider config={config} setConfig={setConfig}>
      <ConfigDriftSettings />
    </ConfigProvider>
  );
}
const field = () => screen.getByLabelText('Unknown after (hours without a report)');

describe('Config drift stale hours', () => {
  it('start at 36 on a config that has never saved them', () => {
    render(<Harness />);
    expect(field()).toHaveValue(36);
    expect(window.__display.driftStaleHours).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Reset to 36 hours' })).toBeDisabled();
  });

  it('a valid change is saved at once; reset clears it', async () => {
    render(<Harness />);
    await userEvent.clear(field());
    await userEvent.type(field(), '72');
    expect(window.__display.driftStaleHours).toBe(72);
    await userEvent.click(screen.getByRole('button', { name: 'Reset to 36 hours' }));
    expect(window.__display.driftStaleHours).toBeUndefined();
    expect(field()).toHaveValue(36);
  });

  it('a value out of range or empty is said and not saved', async () => {
    render(<Harness initial={{ driftStaleHours: 48 }} />);
    await userEvent.clear(field());
    expect(screen.getByRole('alert')).toHaveTextContent('Whole hours, 1 to 720. Not saved.');
    expect(window.__display.driftStaleHours).toBe(48);
    fireEvent.change(field(), { target: { value: '9999' } });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(window.__display.driftStaleHours).toBe(48);
  });

  it('a saved value that is no usable hours shows the default', () => {
    render(<Harness initial={{ driftStaleHours: 'soon' }} />);
    expect(field()).toHaveValue(36);
  });
});
