/**
 * Settings' sections, in the sidebar's order, each at /settings/<id> (#296):
 * its name, icon and what it holds, and `divider` where a new group of the
 * sidebar starts (SettingsView.jsx names the groups). The command palette
 * lists them too (#315), so this stays out of Settings' own chunk.
 */
export const SETTINGS_SECTIONS = Object.freeze([
  { id: 'general', label: 'General', icon: '🏠', desc: 'Title, logo, branding' },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: '🎨',
    desc: 'Theme, Overview sections, background',
  },
  { id: 'typography', label: 'Typography', icon: '🔤', desc: 'Fonts' },
  { id: 'layout', label: 'Layout', icon: '📐', desc: 'Refresh, links, units' },
  { id: 'sections', label: 'Sections', icon: '🧱', desc: 'Utilities, custom groups' },
  { id: 'nodes', label: 'Nodes', icon: '🖥', desc: 'Manage infrastructure nodes', divider: true },
  { id: 'services', label: 'Services', icon: '📦', desc: 'Container overrides & monitors' },
  { id: 'integrations', label: 'Integrations', icon: '🔌', desc: 'App API connections' },
  { id: 'links', label: 'Links', icon: '🔗', desc: 'Quick Launch bookmarks', divider: true },
  { id: 'widgets', label: 'Widgets', icon: '🧩', desc: 'Search, weather, clock' },
  { id: 'tabs', label: 'Tabs', icon: '📑', desc: 'Embedded service tabs' },
  {
    id: 'security',
    label: 'Security',
    icon: '🔒',
    desc: 'Password & authentication',
    divider: true,
  },
  { id: 'backup', label: 'Backup', icon: '💾', desc: 'Export & import config' },
]);
