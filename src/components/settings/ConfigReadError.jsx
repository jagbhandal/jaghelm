import React from 'react';
import InlineError from './InlineError';
import { UiButton } from './primitives.jsx';

/**
 * In place of a Settings tab whose services.yaml can't be shown (#423): why
 * (a services.yaml that doesn't parse names its line), and a way to read it
 * again once it is fixed by hand (the design system's Button, #276).
 */
export default function ConfigReadError({ message, onRetry }) {
  return (
    <div>
      <InlineError message={message} />
      <UiButton variant="secondary" size="sm" onClick={onRetry}>
        Try again
      </UiButton>
    </div>
  );
}
