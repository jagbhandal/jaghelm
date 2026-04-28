import React from 'react';

/**
 * Proxmox-specific child panels rendered inside the PVE NodeCard.
 *
 * These get the integration data straight from /api/integrations once the
 * Proxmox preset has been configured. They render nothing when their data
 * is missing or empty, so they're safe to drop into any node panel that
 * happens to expose them.
 */

function statusColor(status) {
  if (status === 'running') return 'var(--green)';
  if (status === 'paused') return 'var(--amber)';
  return 'var(--red)';
}

function statusBg(status) {
  if (status === 'running') return 'var(--green-bg)';
  if (status === 'paused') return 'var(--amber-bg)';
  return 'var(--red-bg)';
}

function statusBorder(status) {
  if (status === 'running') return 'var(--green-border)';
  if (status === 'paused') return 'var(--amber-border)';
  return 'var(--red-border)';
}

function usageColor(percent, fallback) {
  if (percent > 90) return 'var(--red)';
  if (percent > 70) return 'var(--amber)';
  return fallback || 'var(--accent)';
}

// ── Virtual Machines ─────────────────────────────────────────────────────

export function ProxmoxVMList({ vms, borderColor }) {
  if (!vms || vms.length === 0) return null;

  return (
    <div style={{ marginTop: 8 }}>
      <div className="stat-label" style={{ marginBottom: 6, paddingLeft: 2, fontSize: 9 }}>
        Virtual Machines
      </div>
      <div className="pve-vm-grid">
        {vms.map((vm) => {
          const color = statusColor(vm.status);
          const memPercent =
            vm.memTotalGB && parseFloat(vm.memTotalGB) > 0
              ? (parseFloat(vm.memUsedGB) / parseFloat(vm.memTotalGB)) * 100
              : 0;

          return (
            <div
              key={vm.vmid}
              style={{
                background: 'var(--bg-card-inner)',
                border: '1px solid var(--border-color)',
                borderRadius: 12,
                padding: '10px 12px',
                borderLeft: `3px solid ${color}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    flexShrink: 0,
                    background: color,
                    boxShadow: `0 0 6px ${color}`,
                  }}
                />
                <span
                  style={{
                    fontFamily: 'var(--font-body)',
                    fontSize: 'var(--fs-service-name)',
                    fontWeight: 500,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {vm.name}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--fs-service-badge)',
                    padding: '2px 5px',
                    borderRadius: 4,
                    textTransform: 'uppercase',
                    fontWeight: 500,
                    background: statusBg(vm.status),
                    color,
                    border: `1px solid ${statusBorder(vm.status)}`,
                  }}
                >
                  {vm.status}
                </span>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 6, justifyContent: 'center' }}>
                <div className="stat-box" style={{ padding: '4px 8px' }}>
                  <div className="stat-value">{vm.maxcpu}</div>
                  <div className="stat-label" style={{ marginTop: 1 }}>vCPU</div>
                </div>
                <div className="stat-box" style={{ padding: '4px 8px' }}>
                  <div className="stat-value">{vm.vmid}</div>
                  <div className="stat-label" style={{ marginTop: 1 }}>VMID</div>
                </div>
              </div>

              {vm.memUsedGB && vm.memTotalGB && (
                <div style={{ marginTop: 6, padding: '0 2px' }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      marginBottom: 3,
                    }}
                  >
                    <span className="stat-label">RAM</span>
                    <span className="text-mono text-secondary" style={{ fontSize: 10 }}>
                      {vm.memUsedGB}/{vm.memTotalGB} GB
                    </span>
                  </div>
                  <div
                    style={{
                      height: 4,
                      borderRadius: 2,
                      background: 'rgba(255,255,255,0.06)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        borderRadius: 2,
                        width: `${Math.min(memPercent, 100)}%`,
                        background: usageColor(memPercent, borderColor),
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Storage Pools ────────────────────────────────────────────────────────

export function ProxmoxStoragePools({ pools, borderColor }) {
  if (!pools || pools.length === 0) return null;

  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          color: 'var(--text-muted)',
          letterSpacing: 1,
          textTransform: 'uppercase',
          marginBottom: 6,
          paddingLeft: 2,
        }}
      >
        Storage Pools
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {pools.map((pool) => (
          <div
            key={pool.name}
            style={{
              background: 'var(--bg-card-inner)',
              border: '1px solid var(--border-color)',
              borderRadius: 10,
              padding: '8px 12px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                marginBottom: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500 }}>
                  {pool.name}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                  }}
                >
                  {pool.type}
                </span>
              </div>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                }}
              >
                {pool.usedGB}/{pool.totalGB} GB
              </span>
            </div>
            <div
              style={{
                height: 5,
                borderRadius: 3,
                background: 'rgba(255,255,255,0.06)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  borderRadius: 3,
                  width: `${Math.min(pool.percent, 100)}%`,
                  background: usageColor(pool.percent, borderColor),
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--text-muted)',
                marginTop: 3,
                textAlign: 'right',
              }}
            >
              {pool.percent}%
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Backup Status ────────────────────────────────────────────────────────

export function ProxmoxBackupStatus({ backup }) {
  if (!backup) return null;

  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          color: 'var(--text-muted)',
          letterSpacing: 1,
          textTransform: 'uppercase',
          marginBottom: 6,
          paddingLeft: 2,
        }}
      >
        Backups
      </div>
      <div
        style={{
          background: 'var(--bg-card-inner)',
          border: '1px solid var(--border-color)',
          borderRadius: 10,
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span style={{ fontSize: 16, filter: backup.ok ? 'none' : 'grayscale(1)' }}>
          {backup.ok ? '✓' : '✕'}
        </span>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--text-primary)',
            }}
          >
            Last backup: {backup.ago || 'unknown'}
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--text-muted)',
              marginTop: 1,
            }}
          >
            {backup.vmCount > 0
              ? `${backup.vmCount} VM${backup.vmCount > 1 ? 's' : ''} backed up`
              : 'No VMs in batch'}
          </div>
        </div>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            padding: '2px 8px',
            borderRadius: 4,
            fontWeight: 500,
            background: backup.ok ? 'var(--green-bg)' : 'var(--red-bg)',
            color: backup.ok ? 'var(--green)' : 'var(--red)',
            border: `1px solid ${backup.ok ? 'var(--green-border)' : 'var(--red-border)'}`,
          }}
        >
          {backup.ok ? 'OK' : backup.status || 'FAILED'}
        </span>
      </div>
    </div>
  );
}
