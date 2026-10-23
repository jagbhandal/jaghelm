// The views loaded on first use, each in a chunk of its own, so they stay out
// of the first paint: Settings (13-tab tree), the app frames, the Alerts and
// Launch pages, the phone's More sheet, and the phone screens (#303), which
// only a window below 768px loads. Every React.lazy() in the app takes its loader
// from here, and this is the one place in src/ with a dynamic import()
// (scripts/lazy-views.test.mjs).
//
// The client tests load every export here before a test file's tests run
// (src/testing/setup.js), so a lazy view a test opens renders at once instead
// of racing a 1 s wait while the machine is busy (#490).

export const loadAppFrames = () => import('./views/AppFrames');
export const loadSettingsView = () => import('./views/SettingsView');
export const loadAlertsPage = () => import('./shell/AlertsPage.jsx');
export const loadMoreSheet = () => import('./shell/MoreSheet.jsx');
export const loadLaunchPage = () => import('./shell/LaunchPage.jsx');
export const loadPhoneView = () => import('./shell/PhoneView.jsx');
