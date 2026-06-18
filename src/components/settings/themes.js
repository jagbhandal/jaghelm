// Theme catalogue — data only (no component imports), so App.jsx can read it
// eagerly for theme cycling WITHOUT pulling AppearanceTab (and react-colorful)
// into the initial bundle. AppearanceTab imports it from here too.
export const THEMES = [
  {
    id: 'dark',
    name: 'One Dark Pro',
    preview: '#282c34',
    accent: '#6366f1',
    desc: 'Warm charcoal, indigo accent',
  },
  {
    id: 'dracula',
    name: 'Dracula',
    preview: '#282a36',
    accent: '#bd93f9',
    desc: 'Vibrant purple & pink',
  },
  {
    id: 'night-owl',
    name: 'Night Owl',
    preview: '#011627',
    accent: '#7e57c2',
    desc: 'Deep navy, violet accent',
  },
  {
    id: 'github-dark',
    name: 'GitHub Dark',
    preview: '#0d1117',
    accent: '#58a6ff',
    desc: 'Neutral gray, blue accent',
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin Mocha',
    preview: '#1e1e2e',
    accent: '#cba6f7',
    desc: 'Warm pastels, lavender',
  },
  {
    id: 'material',
    name: 'Material Ocean',
    preview: '#0F111A',
    accent: '#84ffff',
    desc: 'Ultra dark, cyan glow',
  },
  {
    id: 'github-light',
    name: 'GitHub Light',
    preview: '#ffffff',
    accent: '#0969da',
    desc: 'Clean white, familiar',
    light: true,
  },
  {
    id: 'catppuccin-latte',
    name: 'Catppuccin Latte',
    preview: '#eff1f5',
    accent: '#8839ef',
    desc: 'Warm cream, pastel mauve',
    light: true,
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    preview: '#fdf6e3',
    accent: '#2aa198',
    desc: 'Warm ivory, teal accent',
    light: true,
  },
  {
    id: 'one-light',
    name: 'Atom One Light',
    preview: '#fafafa',
    accent: '#e45649',
    desc: 'Crisp white, warm red',
    light: true,
  },
];
