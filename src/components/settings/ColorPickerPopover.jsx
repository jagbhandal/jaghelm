import React, { useState } from 'react';
import { HexColorPicker } from 'react-colorful';

/**
 * ColorPickerPopover — the hex color editor used by every settings tab.
 *
 * Every tab that lets the user pick a color (NodesTab border, SectionsTab
 * section/group/background, AppearanceTab accent) had rebuilt the same trio
 * inline: a <HexColorPicker>, a mono hex <input>, and Apply/Cancel buttons —
 * each copy wiring up its own colorTarget/colorValue/openColor/applyColor
 * state. Extracting it means the picker, the live hex field, and the
 * Apply-tints-the-button affordance live in exactly one place.
 *
 * Draft state is owned here: the popover seeds its working color from `value`
 * and only reports it back via `onApply(color)` when the user commits, so a
 * Cancel leaves the caller's stored color untouched (matching prior behavior).
 *
 * Props:
 *   value    — initial color (hex string); seeds the draft
 *   onApply  — (color) => void, called with the committed hex on Apply
 *   onCancel — () => void, called on Cancel
 */
export default function ColorPickerPopover({ value, onApply, onCancel }) {
  const [color, setColor] = useState(value || '#6366f1');

  return (
    <>
      <HexColorPicker
        color={color}
        onChange={setColor}
        style={{ width: '100%', maxWidth: 300, height: 150 }}
      />
      <div className="settings-actions">
        <input
          className="settings-input mono flex-1"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
        <button
          className="settings-btn-primary"
          onClick={() => onApply(color)}
          style={{ background: color }}
        >
          Apply
        </button>
        <button className="settings-btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </>
  );
}
