import React from 'react';
import { PhoneSheet } from './PhoneSheet.jsx';
import BackHeader from './BackHeader.jsx';
import { DetailTitle } from './DetailParts.jsx';

/**
 * The sheet: a PhoneSheet with the screen's Back and kind (`eyebrow`), the
 * title (it names the sheet) over where it is (`description`), then the
 * charts. `drill` is the chart's id, kept as `data-drill`.
 */
export default function DrillSheet({ drill, eyebrow, title, description, onClose, children }) {
  return (
    <PhoneSheet index={`drill-${drill}`} onClose={onClose}>
      <BackHeader kind={eyebrow} onBack={onClose} />
      <div data-drill={drill} className="flex flex-col gap-4 px-4 pt-3 pb-6">
        <DetailTitle title={title} where={description} />
        {children}
      </div>
    </PhoneSheet>
  );
}
