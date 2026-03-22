export default {
  name: 'Proxmox',
  icon: 'proxmox',
  description: 'Virtualization management platform',
  auth: 'header',
  authHeader: 'Authorization',
  authPrefix: 'PVEAPIToken=',
  endpoint: '/api2/json/cluster/resources?type=vm',
  testEndpoint: '/api2/json/version',
  tlsSkip: true,
  fields: [
    { key: 'vms', label: 'VMs', path: 'data._length', format: 'number' },
    { key: 'running', label: 'Running', path: 'data._filter:status=running', format: 'number' },
  ],
  structuredTransform: (raw) => {
    const vms = (raw?.data || []).map(vm => ({
      name: vm.name || `VM ${vm.vmid}`,
      vmid: vm.vmid,
      status: vm.status || 'unknown',
      maxcpu: vm.maxcpu || 0,
    }));
    // Sort: running first, then by vmid
    vms.sort((a, b) => {
      if (a.status === 'running' && b.status !== 'running') return -1;
      if (a.status !== 'running' && b.status === 'running') return 1;
      return a.vmid - b.vmid;
    });
    return { vms };
  },
  envKeys: {
    url: 'PROXMOX_URL',
    token: 'PROXMOX_TOKEN',
  },
};
