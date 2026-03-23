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
  fields: [],

  // Extra endpoints fetched after the primary VM endpoint.
  // Function receives the primary response so we can extract the node name
  // from the VM data and build the backup tasks URL dynamically.
  extraEndpoints: (rawData) => {
    // Extract node name from the first VM in the response
    const vms = rawData?.data || [];
    const nodeName = vms.find(v => v.node)?.node || 'pve';
    return [
      { key: 'storage', endpoint: '/api2/json/cluster/resources?type=storage' },
      { key: 'tasks', endpoint: `/api2/json/nodes/${nodeName}/tasks?typefilter=vzdump&limit=10&source=all` },
    ];
  },

  structuredTransform: (raw) => {
    // ── VMs ──
    const vms = (raw?.data || []).map(vm => {
      const memUsedGB = typeof vm.mem === 'number' ? (vm.mem / 1073741824).toFixed(1) : null;
      const memTotalGB = typeof vm.maxmem === 'number' ? (vm.maxmem / 1073741824).toFixed(1) : null;
      return {
        name: vm.name || `VM ${vm.vmid}`,
        vmid: vm.vmid,
        status: vm.status || 'unknown',
        maxcpu: vm.maxcpu || 0,
        memUsedGB,
        memTotalGB,
        uptime: vm.uptime || 0,
      };
    });
    vms.sort((a, b) => {
      if (a.status === 'running' && b.status !== 'running') return -1;
      if (a.status !== 'running' && b.status === 'running') return 1;
      return a.vmid - b.vmid;
    });
    const running = vms.filter(v => v.status === 'running').length;
    const total = vms.length;

    // ── Storage pools ──
    const storageRaw = raw?._extra?.storage?.data || [];
    // Filter to pools that store VM images/disks, skip backup-only and ISO-only pools
    const storagePools = storageRaw
      .filter(s => {
        const content = s.content || '';
        // Include pools that can hold VM images or rootdir (LXC)
        return content.includes('images') || content.includes('rootdir') ||
               s.plugintype === 'lvmthin' || s.plugintype === 'zfspool' ||
               s.plugintype === 'lvm';
      })
      .map(s => {
        const usedBytes = s.disk || 0;
        const totalBytes = s.maxdisk || 0;
        const usedGB = (usedBytes / 1073741824).toFixed(1);
        const totalGB = (totalBytes / 1073741824).toFixed(1);
        const percent = totalBytes > 0 ? ((usedBytes / totalBytes) * 100).toFixed(1) : 0;
        return {
          name: s.storage || 'unknown',
          type: s.plugintype || 'unknown',
          usedGB,
          totalGB,
          percent: parseFloat(percent),
          status: s.status || 'unknown',
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    // ── Backup tasks ──
    const tasksRaw = raw?._extra?.tasks?.data || [];
    // Find the most recent vzdump task per VM
    const backupTasks = tasksRaw
      .filter(t => t.type === 'vzdump')
      .sort((a, b) => (b.starttime || 0) - (a.starttime || 0));

    let lastBackup = null;
    if (backupTasks.length > 0) {
      const latest = backupTasks[0];
      const startTime = latest.starttime ? latest.starttime * 1000 : null;
      const ago = startTime ? timeSince(startTime) : null;
      const ok = latest.status === 'OK';
      // Count unique VMIDs in recent backup batch (same starttime = same scheduled job)
      const batchTime = latest.starttime;
      const batchVms = [...new Set(
        backupTasks
          .filter(t => t.starttime === batchTime && t.status === 'OK')
          .map(t => {
            // Extract VMID from the task ID (format includes vmid)
            const match = t.id?.match(/vzdump:(\d+)/);
            return match ? match[1] : t.id;
          })
          .filter(Boolean)
      )];
      lastBackup = {
        time: startTime,
        ago,
        ok,
        status: latest.status,
        vmCount: batchVms.length,
        vmids: batchVms,
      };
    }

    const fields = {
      'Running': `${running}/${total}`,
    };

    return { fields, vms, storagePools, lastBackup };
  },

  envKeys: {
    url: 'PROXMOX_URL',
    token: 'PROXMOX_TOKEN',
  },
};

// Helper: human-readable time since a timestamp
function timeSince(ts) {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
