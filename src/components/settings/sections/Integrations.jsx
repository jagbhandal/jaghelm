import React from 'react';
import { Plug } from 'lucide-react';
import IntegrationsTab from '../IntegrationsTab';

/**
 * Settings → Integrations (#317): the apps JagHelm reads stats from, as the
 * Integrations tab had them; #323 rebuilds it on the design system.
 */
export default function Integrations() {
  return <IntegrationsTab />;
}

Integrations.icon = <Plug />;

/** What Settings' search finds Integrations by (settingsSearch.js). */
Integrations.settings = Object.freeze([
  {
    name: 'Integrations',
    words:
      'integration integrations api key token password credentials connect preset presets gallery add test custom json apps stats',
  },
]);
