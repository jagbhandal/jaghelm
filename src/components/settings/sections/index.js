/**
 * Each Settings section's module (#317), by its id in ../sections.js, the one
 * list of sections. A module is the section's page: its default export draws
 * it (with `theme` and `setTheme`, for Appearance), `icon` is its lucide icon
 * and `settings` what Settings' search finds it by (settingsSearch.js), each
 * `{ name, words }`: a heading on its page, and its controls' names and
 * synonyms. A section's card (#318–#323) changes its own module only.
 */
import NodesServices from './NodesServices.jsx';
import Integrations from './Integrations.jsx';
import AppsLinks from './AppsLinks.jsx';
import Appearance from './Appearance.jsx';
import System from './System.jsx';

export const SECTION_VIEWS = Object.freeze({
  nodes: NodesServices,
  integrations: Integrations,
  apps: AppsLinks,
  appearance: Appearance,
  system: System,
});
