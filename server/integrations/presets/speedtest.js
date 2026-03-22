export default {
  name: 'Speedtest Tracker',
  icon: 'speedtest-tracker',
  description: 'Automated internet speed monitoring',
  auth: 'none',
  endpoint: '/api/speedtest/latest',
  testEndpoint: '/api/speedtest/latest',
  fields: [
    { key: 'download', label: 'Download', path: 'data.download', format: 'decimal' },
    { key: 'upload', label: 'Upload', path: 'data.upload', format: 'decimal' },
    { key: 'ping', label: 'Ping', path: 'data.ping', format: 'decimal' },
  ],
  envKeys: {
    url: 'SPEEDTEST_URL',
  },
};
