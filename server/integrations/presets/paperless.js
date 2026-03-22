export default {
  name: 'Paperless-ngx',
  icon: 'paperless-ngx',
  description: 'Document management with OCR',
  auth: 'bearer',
  endpoint: '/api/documents/?page_size=1',
  testEndpoint: '/api/ui_settings/',
  fields: [
    { key: 'documents', label: 'Docs', path: 'count', format: 'number' },
  ],
  envKeys: {
    url: 'PAPERLESS_URL',
    token: 'PAPERLESS_TOKEN',
  },
};
