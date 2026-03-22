export default {
  name: 'NZBGet',
  icon: 'nzbget',
  description: 'Usenet download client',
  auth: 'basic',
  endpoint: '/jsonrpc/status',
  testEndpoint: '/jsonrpc/version',
  fields: [
    { key: 'remaining', label: 'Remaining', path: 'result.RemainingSizeMB', format: 'number' },
    { key: 'speed', label: 'Speed', path: 'result.DownloadRate', format: 'bytes' },
  ],
  envKeys: {
    url: 'NZBGET_URL',
    username: 'NZBGET_USER',
    password: 'NZBGET_PASS',
  },
};
