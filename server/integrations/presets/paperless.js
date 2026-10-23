export default {
  name: 'Paperless-ngx',
  icon: 'paperless-ngx',
  description: 'Document management with OCR',
  auth: 'bearer',
  endpoint: '/api/documents/?page_size=1',
  fields: [
    { key: 'documents', label: 'Docs', path: 'count', format: 'number' },
  ],
  envKeys: {
    url: 'JAGHELM_PAPERLESS_URL',
    token: 'JAGHELM_PAPERLESS_TOKEN',
  },
};
