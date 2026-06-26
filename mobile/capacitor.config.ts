import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.jaghelm.app', // MUST equal the Firebase Android package name (Phase 4/5)
  appName: 'JagHelm',
  webDir: 'dist', // mobile/dist — Capacitor webDir, NOT server-served
  server: {
    androidScheme: 'https', // explicit — Capacitor default is http://localhost
    hostname: 'localhost',
    // NO `url` (live-reload escape hatch — would point prod at a dev box).
    // `cleartext` left false: Tailscale already encrypts transport.
    // `allowNavigation` left empty: app talks to backend via native HTTP, not nav.
  },
  plugins: {
    CapacitorHttp: { enabled: true }, // native HTTP = default transport (bypasses CORS, reads ETag)
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] }, // declared for Phase 5
    // Capacitor 8 / Android 15 (SDK 35+) enforce edge-to-edge by default.
    // SystemBars.insetsHandling = 'css' injects correct --safe-area-inset-* CSS variables
    // into the WebView so layouts respect navigation bars / notch regardless of WebView version.
    // (Task 8: `android.adjustMarginsForEdgeToEdge` was NOT a valid CapacitorConfig key —
    //  removed; SystemBars plugin config is the correct Cap 8 hook.)
    SystemBars: { insetsHandling: 'css' },
  },
};

export default config;
