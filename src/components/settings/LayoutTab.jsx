import React from 'react';
import { useConfig } from '../../context/ConfigContext.jsx';
import { useConfirm, useToast } from '../../context/OverlayContext.jsx';
import Field from './Field';
import { Card, ChoiceGroup } from './primitives.jsx';
import { autoArrange } from '../HelmGrid/gridMath.js';

export default function LayoutTab() {
  const { config, update } = useConfig();
  const confirm = useConfirm();
  const toast = useToast();

  const resetGridLayout = async () => {
    const ok = await confirm({
      title: 'Reset grid layout?',
      body: 'This resets all panel positions and sizes to their defaults. This cannot be undone.',
      confirmLabel: 'Reset Layout',
      danger: true,
    });
    if (ok) update('gridLayout', null);
  };

  // "Tidy up" — pack every panel gaplessly in priority order. Operates on the
  // saved layout (per breakpoint); sm is stacked, so it's left alone.
  const autoArrangeLayout = async () => {
    const current = config.gridLayout;
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      toast('Layout is already at its default arrangement.', 'info');
      return;
    }
    const ok = await confirm({
      title: 'Auto-arrange panels?',
      body: 'Packs every panel top-to-bottom, left-to-right with no gaps (nodes first, then widgets, then groups). Your current positions are replaced — you can drag them back.',
      confirmLabel: 'Tidy up',
    });
    if (!ok) return;
    const colsFor = (bp) => (bp === 'md' ? 20 : config.gridColumns || 24);
    const next = {};
    for (const [bp, items] of Object.entries(current)) {
      next[bp] = bp === 'sm' || !Array.isArray(items) ? items : autoArrange(items, colsFor(bp));
    }
    update('gridLayout', next);
    toast('Panels tidied up.', 'success');
  };

  return (
    <div className="settings-section">
      <Card title="Grid">
        <Field label={`Grid Columns: ${config.gridColumns || 24}`}>
          <input
            type="range"
            min="6"
            max="24"
            step="2"
            value={config.gridColumns || 24}
            onChange={(e) => update('gridColumns', parseInt(e.target.value))}
            className="settings-range"
          />
          <div className="settings-range-labels">
            <span>6 (compact)</span>
            <span>12 (default)</span>
            <span>24 (fine grid)</span>
          </div>
          <div className="settings-hint-block" style={{ marginTop: 8 }}>
            More columns = finer positioning and narrower panels possible. Changing this resets
            panel positions.
          </div>
        </Field>

        <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="settings-btn" onClick={autoArrangeLayout}>
            ✨ Auto-arrange
          </button>
          <button className="settings-btn-danger" onClick={resetGridLayout}>
            Reset Grid Layout
          </button>
        </div>
        <p className="settings-hint-block" style={{ marginTop: 8 }}>
          <strong>Auto-arrange</strong> tidies panels into a gapless grid (you keep your
          panels and sizes). <strong>Reset</strong> returns everything to defaults.
        </p>
      </Card>

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

        <Field label="Collapsible Sections">
          <label className="settings-checkbox-label">
            <input
              type="checkbox"
              checked={config.collapsibleSections || false}
              onChange={(e) => update('collapsibleSections', e.target.checked)}
              className="settings-checkbox"
            />
            <span className="settings-checkbox-text">
              Allow clicking section headers to collapse/expand
            </span>
          </label>
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
