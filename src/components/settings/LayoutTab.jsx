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

      <Card title="Service Cards">
        <Field label="Docker Metrics (CPU, MEM, RX, TX)">
          <label className="settings-checkbox-label">
            <input
              type="checkbox"
              checked={config.showDockerStats !== false}
              onChange={(e) => update('showDockerStats', e.target.checked)}
              className="settings-checkbox"
            />
            <span className="settings-checkbox-text">
              Show per-container CPU, memory, and network stats
            </span>
          </label>
        </Field>

        <Field label="App Integration Data">
          <label className="settings-checkbox-label">
            <input
              type="checkbox"
              checked={config.showAppData !== false}
              onChange={(e) => update('showAppData', e.target.checked)}
              className="settings-checkbox"
            />
            <span className="settings-checkbox-text">
              Show app-specific API data (queries blocked, streams, etc.)
            </span>
          </label>
        </Field>

        <Field label={`Service Columns per Row: ${config.serviceColumns || 'Auto'}`}>
          <ChoiceGroup
            ariaLabel="Service Columns per Row"
            value={config.serviceColumns || 0}
            options={[0, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: n === 0 ? 'Auto' : n }))}
            onChange={(value) => update('serviceColumns', value)}
          />
          <div className="settings-hint-block" style={{ marginTop: 8 }}>
            <strong>Auto:</strong> Cards fill available space responsively
            <br />
            <strong>2–6:</strong> Maximum columns — cards reflow to fewer columns as the panel
            narrows
          </div>
        </Field>

        <Field label="Card Layout">
          <ChoiceGroup
            ariaLabel="Card Layout"
            value={config.cardLayout || 'row'}
            options={[
              { value: 'list', label: 'List' },
              { value: 'row', label: 'Row' },
              { value: 'grid', label: 'Grid' },
            ]}
            onChange={(value) => update('cardLayout', value)}
          />
          <div className="settings-hint-block">
            List: clean rows, no backgrounds. Row: subtle card per service (default). Grid: compact
            card boxes.
          </div>
        </Field>

        <Field label="Status Style">
          <ChoiceGroup
            ariaLabel="Status Style"
            value={config.statusStyle || 'badge'}
            options={['dot', 'badge', 'minimal']}
            onChange={(value) => update('statusStyle', value)}
          />
          <div className="settings-hint-block">
            How container status is displayed on service cards
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
