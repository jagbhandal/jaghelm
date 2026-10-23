/**
 * Where each kind of entity is set up, in Settings (#317), for the detail
 * drawer's "… settings" link (detailLinks.js): the link's words, the section
 * and the part of it (src/components/settings/sections.js), which
 * scripts/settings-places.test.mjs checks are live. A module of its own, with
 * no imports, so that test can read it.
 */
// A node's and a service's are Nodes & Services'; the UPS's is its Power
// section's switch, in Appearance's Overview sections.
export const SETTINGS_LINKS = Object.freeze({
  node: ['Node settings', 'nodes', 'nodes'],
  service: ['Service settings', 'nodes', 'services'],
  container: ['Service settings', 'nodes', 'services'],
  integration: ['Integration settings', 'integrations'],
  agent: ['Integration settings', 'integrations'],
  ups: ['UPS settings', 'appearance', 'overview-sections'],
});
