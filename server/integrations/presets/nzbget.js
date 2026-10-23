export default {
  name: 'NZBGet',
  icon: 'nzbget',
  description: 'Usenet download client',
  auth: 'basic',
  endpoint: '/jsonrpc/status',
  fields: [
    { key: 'remaining', label: 'Remaining', path: 'result.RemainingSizeMB', format: 'number' },
    { key: 'speed', label: 'Speed', path: 'result.DownloadRate', format: 'bytes' },
  ],
  envKeys: {
    url: 'JAGHELM_NZBGET_URL',
    username: 'JAGHELM_NZBGET_USER',
    password: 'JAGHELM_NZBGET_PASS', // pragma: allowlist secret
  },
};
