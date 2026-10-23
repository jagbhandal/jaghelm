import React from 'react';
import { useConfig } from '../../context/ConfigContext.jsx';
import Field from './Field';
import { Card, ChoiceGroup } from './primitives.jsx';

/**
 * Settings → Layout: the refresh interval, where links open, the temperature
 * unit and the cards' blur. The old board's grid (its columns, Auto-arrange,
 * Reset) went with it (#306): the Overview reflows, and arranging comes back
 * as Edit layout (Phase 5).
 */
export default function LayoutTab() {
  const { config, update } = useConfig();

  return (
    <div className="settings-section">
      <Card title="Refresh">
        <Field label={`Auto-refresh Interval: ${config.refreshInterval || 30}s`}>
          <input
            type="range"
            min="10"
            max="120"
            step="5"
            value={config.refreshInterval || 30}
            onChange={(e) => update('refreshInterval', parseInt(e.target.value))}
            className="settings-range"
          />
          <div className="settings-range-labels">
            <span>10s (fast)</span>
            <span>120s (slow)</span>
          </div>
        </Field>
      </Card>

      <Card title="Behavior">
        <Field label="Link Target">
          <ChoiceGroup
            ariaLabel="Link Target"
            value={config.linkTarget || '_blank'}
            options={[
              { value: '_blank', label: 'New Tab' },
              { value: '_self', label: 'Same Tab' },
            ]}
            onChange={(value) => update('linkTarget', value)}
          />
          <div className="settings-hint-block">Where Quick Launch links and service links open</div>
        </Field>

        <Field label="Temperature Unit">
          <ChoiceGroup
            ariaLabel="Temperature Unit"
            value={config.tempUnit || 'F'}
            options={[
              { value: 'F', label: '°F' },
              { value: 'C', label: '°C' },
            ]}
            onChange={(value) => update('tempUnit', value)}
          />
        </Field>
      </Card>

      <Card title="Visual">
        <Field label={`Card Blur: ${config.cardBlur || 'none'}`}>
          <ChoiceGroup
            ariaLabel="Card Blur"
            value={config.cardBlur || 'none'}
            options={['none', 'sm', 'md', 'lg']}
            onChange={(value) => update('cardBlur', value)}
          />
          <div className="settings-hint-block">
            Backdrop blur effect on cards (requires a background image to be visible)
          </div>
        </Field>
      </Card>
    </div>
  );
}
