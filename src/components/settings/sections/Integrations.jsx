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
