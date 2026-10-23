/**
 * The display config the app runs with before the user saves one: what a fresh
 * install shows when /api/display-config answers null and nothing is stored in
 * the browser. A new object each call, so a caller may keep it as state.
 */
export function defaultConfig() {
  return {
    title: 'JAGHELM',
    subtitle: 'Infrastructure Dashboard',
    logoUrl: '',
    bgImage: '',
    bgOpacity: 0.3,
    overlayOpacity: 0.75,
    showDots: true,
    refreshInterval: 30,
    searchEngine: 'google',
    showSearch: true,
    weatherLat: '',
    weatherLon: '',
    showWeather: false,
    weatherCity: '',
    showClock: true,
    tabs: [],
    sections: {},
    links: {},
  };
}
