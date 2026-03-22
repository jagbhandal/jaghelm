export default {
  name: 'Frigate',
  icon: 'frigate',
  description: 'NVR with real-time AI object detection',
  auth: 'none',
  endpoint: '/api/stats',
  testEndpoint: '/api/version',
  fields: [
    { key: 'cameras', label: 'Cameras', path: 'cameras._length', format: 'number' },
    { key: 'detection_fps', label: 'Detect FPS', path: 'detection_fps', format: 'decimal' },
    { key: 'uptime', label: 'Uptime', path: 'service.uptime', format: 'duration' },
  ],
  envKeys: {
    url: 'FRIGATE_URL',
  },
};
