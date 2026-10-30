// The views loaded on first use, each in a chunk of its own, so they stay out
// of the first paint: Settings (13-tab tree), the app frames, the Alerts,
// Launch, Services and Infrastructure pages, the phone's More sheet, the phone screens (#303), which
// only a window below 768px loads, and their detail screens, and the
// desktop's detail drawer (#309), each loaded when the first one opens. Every React.lazy() in the app takes its loader
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
// The Services and Infrastructure pages (#313), from 768px; below it the
// phone's tabs draw the same addresses.
export const loadServicesPage = () => import('./shell/ServicesPage.jsx');
export const loadInfrastructurePage = () => import('./shell/InfrastructurePage.jsx');
// The Monitoring page (#751), from 768px: its own chunk, with the Chart and its drawings.
export const loadMonitoringPage = () => import('./shell/MonitoringPage.jsx');
// Its phone page (#755), below 768px: a chunk only a phone loads, on the first visit.
export const loadPhoneMonitoring = () => import('./phone/views/Monitoring.jsx');
// The guided first run (#322): only a fresh install opens it, so no one else loads it.
export const loadSetupWizard = () => import('./firstRun/SetupWizard.jsx');
export const loadPhoneView = () => import('./shell/PhoneView.jsx');
export const loadEntityDrawer = () => import('./shell/detail/EntityDrawer.jsx');
export const loadPhoneDetail = () => import('./shell/PhoneDetail.jsx');
// The Overview's Jobs section (#578): a desktop's first screen asks for it at
// once, beside the status poll (OverviewBoard waits for both), so a phone's
// first load doesn't carry it; and the phone's list, with the Infrastructure tab.
export const loadOverviewJobs = () => import('./shell/OverviewJobs.jsx');
export const loadPhoneJobs = () => import('./shell/PhoneJobs.jsx');
// The pending host steps (#673), on the Overview and the phone's: drawn, and
// asked of the server, only when one of them renders, so no first load
// carries it.
export const loadHostActions = () => import('./shell/HostActions.jsx');
// The Expiry section (#676), on the same terms.
export const loadExpiry = () => import('./shell/Expiry.jsx');
// The Backups section (#675), on the Overview and the phone's: drawn, and asked
// of the server, only when one of them renders, so no first load carries it.
export const loadBackups = () => import('./shell/Backups.jsx');
// The config drift row (#674), on the Overview and the phone's: drawn, and asked
// of the server, only when one of them renders, so no first load carries it.
export const loadConfigDrift = () => import('./shell/ConfigDrift.jsx');
// The Overview's Edit layout panel (#330): loaded when the mode is entered,
// so no first load carries it.
export const loadOverviewEditor = () => import('./shell/OverviewEditor.jsx');
// The Overview's utilities rail (#532): only a window from 1440px draws it,
// so a phone's first load doesn't carry the utilities' components.
export const loadOverviewRail = () => import('./shell/OverviewRail.jsx');
// Settings → Appearance's accent set (#321): the shell loads it only to map
// an accent colour a config saved before #304 (src/shell/appearance.js), so
// the first load doesn't carry it; Settings has it in its own chunk anyway.
// Custom themes (#331): the validator, its contrast maths and the built-in
// themes' colours (server/themes.js). Loaded only when a custom theme is
// chosen, and by Settings → Appearance (in its own chunk anyway).
export const loadThemes = () => import('../server/themes.js');
export const loadAccentSet = () => import('./components/settings/sections/accentSet.js');
// The command palette's index (#611): its rows, the search over them and
// Settings' search terms. The palette's trigger and shell stay in the first
// load; this loads when ⌘K first opens, or once the browser is idle.
export const loadCommandPaletteIndex = () => import('./components/CommandPaletteIndex.js');
// The "Sign in again" notice (#653): Cloudflare Access's session ended. Only that
// loads it, so a first load carries nothing for it.
export const loadAccessExpired = () => import('./ui/access-expired.jsx');
// "Alerts on this phone stopped" (#653) and the quiet check behind it, run once a
// load after sign-in (webPushSync.js): neither is in a first load.
export const loadAlertsStopped = () => import('./ui/alerts-stopped.jsx');
export const loadWebPushSync = () => import('./webPushSync.js');
