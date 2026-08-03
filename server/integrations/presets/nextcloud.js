export default {
  name: 'Nextcloud',
  icon: 'nextcloud',
  description: 'Self-hosted file sync, share, and collaboration',
  // Auth is the serverinfo API's own token, sent as the `NC-Token` header —
  // NOT basic auth. serverinfo (`/apps/serverinfo/api/v1/info`) is built for
  // unattended monitoring and accepts a dedicated token so you never put an
  // admin login in a dashboard. Basic auth here is actively harmful: every poll
  // is a login attempt, so a wrong/rotated password silently trips Nextcloud's
  // brute-force protection, throttles the proxy IP, and floods the NC log with
  // "Reached maximum delay" 429s. Generate a token on the Nextcloud host:
  //   TOKEN=$(openssl rand -hex 32)
  //   occ config:app:set serverinfo token --value "$TOKEN"
  // then paste $TOKEN into the integration's API Key field.
  auth: 'header',
  authHeader: 'NC-Token',
  extraHeaders: { 'OCS-APIREQUEST': 'true' },
  endpoint: '/ocs/v2.php/apps/serverinfo/api/v1/info?format=json',
  // Test against the same token-gated endpoint we actually poll. The old
  // testEndpoint (`/ocs/v2.php/cloud/capabilities`) does NOT honor NC-Token —
  // it needs a logged-in user — so a valid token would fail the connection test.
  testEndpoint: '/ocs/v2.php/apps/serverinfo/api/v1/info?format=json',
  fields: [
    { key: 'files', label: 'Files', path: 'ocs.data.nextcloud.storage.num_files', format: 'number' },
    { key: 'users', label: 'Users', path: 'ocs.data.nextcloud.storage.num_users', format: 'number' },
    { key: 'storage', label: 'Storage', path: 'ocs.data.nextcloud.system.freespace', format: 'bytes' },
    { key: 'appdata', label: 'App Data', path: 'ocs.data.nextcloud.storage.size_appdata_storage', format: 'bytes' },
  ],
  envKeys: {
    url: 'NEXTCLOUD_URL',
    token: 'NEXTCLOUD_TOKEN',
  },
};
