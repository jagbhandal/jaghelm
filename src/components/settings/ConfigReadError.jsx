import React from 'react';
import InlineError from './InlineError';

/**
 * In place of a Settings tab whose services.yaml can't be shown (#423): why
 * (a services.yaml that doesn't parse names its line), and a way to read it
 * again once it is fixed by hand.
 */
export default function ConfigReadError({ message, onRetry }) {
  return (
    <div>
      <InlineError message={message} />
      <button type="button" className="settings-btn" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
