import React, { useState } from 'react';

export default function SecurityTab() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleChangePassword = async () => {
    setStatus(null);
    if (!currentPassword || !newPassword) {
      setStatus({ ok: false, msg: 'Please fill in all fields.' });
      return;
    }
    if (newPassword.length < 6) {
      setStatus({ ok: false, msg: 'New password must be at least 6 characters.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setStatus({ ok: false, msg: 'New passwords do not match.' });
      return;
    }
    setSaving(true);
    try {
      const r = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await r.json();
      if (r.ok && data.ok) {
        setStatus({ ok: true, msg: 'Password changed successfully. Other sessions have been invalidated.' });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setStatus({ ok: false, msg: data.error || 'Failed to change password.' });
      }
    } catch {
      setStatus({ ok: false, msg: 'Connection failed.' });
    }
    setSaving(false);
  };

  return (
    <div className="settings-section">
      <Card title="Change Password">
        <p className="settings-desc" style={{ marginBottom: 16 }}>
          Update your dashboard login password. This overrides the password set in the <code className="settings-mono" style={{
            fontSize: 12, background: 'var(--bg-card-inner)',
            padding: '2px 6px', borderRadius: 4,
          }}>.env</code> file.
        </p>

        <Field label="Current Password">
          <input
            className="settings-input"
            type="password"
            value={currentPassword}
            onChange={e => setCurrentPassword(e.target.value)}
            placeholder="Enter current password"
          />
        </Field>

        <Field label="New Password">
          <input
            className="settings-input"
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            placeholder="Enter new password (min 6 characters)"
          />
        </Field>

        <Field label="Confirm New Password">
          <input
            className="settings-input"
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            placeholder="Re-enter new password"
            onKeyDown={e => e.key === 'Enter' && handleChangePassword()}
          />
        </Field>

        {status && (
          <div style={{
            padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 14,
            background: status.ok ? 'var(--green-bg)' : 'var(--red-bg)',
            color: status.ok ? 'var(--green)' : 'var(--red)',
            border: `1px solid ${status.ok ? 'var(--green-border)' : 'var(--red-border)'}`,
          }}>
            {status.msg}
          </div>
        )}

        <button
          className="settings-btn-primary"
          onClick={handleChangePassword}
          disabled={saving}
        >
          {saving ? 'Changing...' : 'Change Password'}
        </button>
      </Card>

      <Card title="Session Info">
        <p className="settings-desc">
          Sessions expire after 24 hours. Changing your password will invalidate all other active sessions.
        </p>
      </Card>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div className="settings-card">
      {title && <h3 className="settings-card-title">{title}</h3>}
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="settings-field">
      <label className="settings-label">{label}</label>
      {children}
    </div>
  );
}
