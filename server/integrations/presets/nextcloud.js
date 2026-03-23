export default {
  name: 'Nextcloud',
  icon: 'nextcloud',
  description: 'Self-hosted file sync, share, and collaboration',
  auth: 'basic',
  extraHeaders: { 'OCS-APIREQUEST': 'true' },
  endpoint: '/ocs/v2.php/apps/serverinfo/api/v1/info?format=json',
  testEndpoint: '/ocs/v2.php/cloud/capabilities?format=json',
  fields: [
    { key: 'files', label: 'Files', path: 'ocs.data.nextcloud.storage.num_files', format: 'number' },
    { key: 'users', label: 'Users', path: 'ocs.data.nextcloud.storage.num_users', format: 'number' },
    { key: 'storage', label: 'Storage', path: 'ocs.data.nextcloud.system.freespace', format: 'bytes' },
  ],
  envKeys: {
    url: 'NEXTCLOUD_URL',
    username: 'NEXTCLOUD_USER',
    password: 'NEXTCLOUD_PASS',
  },
};
