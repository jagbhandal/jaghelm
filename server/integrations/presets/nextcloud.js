export default {
  name: 'Nextcloud',
  icon: 'nextcloud',
  description: 'Self-hosted file sync, share, and collaboration',
  auth: 'basic',
  extraHeaders: { 'OCS-APIREQUEST': 'true' },
  endpoint: '/ocs/v2.php/apps/serverinfo/api/v1/info?format=json',
  testEndpoint: '/ocs/v2.php/cloud/capabilities?format=json',
  fields: [
    { key: 'users', label: 'Users', path: 'ocs.data.activeUsers.last5minutes', format: 'number' },
    { key: 'files', label: 'Files', path: 'ocs.data.nextcloud.storage.num_files', format: 'number' },
    { key: 'storage', label: 'Storage', path: 'ocs.data.nextcloud.storage.num_storages_local', format: 'number' },
  ],
  envKeys: {
    url: 'NEXTCLOUD_URL',
    username: 'NEXTCLOUD_USER',
    password: 'NEXTCLOUD_PASS',
  },
};
