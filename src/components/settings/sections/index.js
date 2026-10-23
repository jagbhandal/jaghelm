/**
 * Each Settings section's module (#317), by its id in ../sections.js, the one
 * list of sections. A module is the section's page: its default export draws
 * it (with `theme` and `setTheme`, for Appearance) and `icon` is its lucide
 * icon. Each of its parts (a Card or a Group) carries the id sections.js
 * names as that part's anchor, under the heading it names, so a search match
 * or an old address opens the section at it. A section's card (#318–#323)
 * changes its module and its entry in sections.js.
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
