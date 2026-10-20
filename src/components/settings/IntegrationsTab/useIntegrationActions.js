import { useState } from 'react';
import { apiFetch } from '../../../api/client.js';
import { useConfirm, useToast } from '../../../context/OverlayContext.jsx';

/**
 * useIntegrationActions — wraps the four API-touching handlers (test, save,
 * delete, toggle) and their UI status state.
 *
 * Dependencies passed in:
 *   selectedPreset  — preset object the form is configured against (null = custom)
 *   editingType     — storage key when editing an existing integration (null = new)
 *   form            — useConfigForm() return value (read-only here)
 *   refetch         — refetches presets/configured/containers from the server
 *   onAfterSave     — called on successful save (typically goHome())
 */
export function useIntegrationActions({ selectedPreset, editingType, form, refetch, onAfterSave }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [testStatus, setTestStatus] = useState(null);
  const [saveStatus, setSaveStatus] = useState(null);

  // ── Test connection ──
  const handleTest = async () => {
    setTestStatus('testing');
    try {
      const body = {
        type: selectedPreset?.type || '_custom',
        url: form.url,
      };
      if (form.username) body.username = form.username;
      if (form.password) body.password = form.password;
      if (form.token) body.token = form.token;
      if (Object.keys(form.params).length > 0) body.params = form.params;

      const res = await apiFetch('/api/integrations/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setTestStatus(data);
    } catch (err) {
      setTestStatus({ ok: false, error: err.message });
    }
  };

  // ── Save integration ──
  const handleSave = async () => {
    setSaveStatus('saving');
    try {
      const body = {
        type: selectedPreset?.type || editingType || '_custom',
        url: form.url,
        enabled: form.enabled,
      };
      if (form.instance.trim())
        body.instance = form.instance
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '');
      // The server merges this into the stored entry (#402): target and
      // username are always sent, so emptying one clears it; a blank password
      // or token is left out and keeps the stored one.
      body.target = form.target;
      body.username = form.username;
      if (form.password) body.password = form.password;
      if (form.token) body.token = form.token;
      if (Object.keys(form.params).length > 0) body.params = form.params;
      // When editing, send the original storage key: the server merges into
      // that entry, and moves it to a new key only when the instance changed.
      if (editingType) body.editingKey = editingType;

      const res = await apiFetch('/api/integrations/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setSaveStatus('saved');
        setTimeout(() => {
          onAfterSave?.();
        }, 800);
      } else {
        setSaveStatus({ error: data.error || 'Save failed' });
      }
    } catch (err) {
      setSaveStatus({ error: err.message });
    }
  };

  // ── Delete integration ──
  // Returns true only when the user confirmed AND the delete succeeded, so
  // callers (e.g. ConfigView) navigate away only on a real deletion. A failed
  // request surfaces a toast instead of silently leaving the UI stale.
  const handleDelete = async (type) => {
    const ok = await confirm({
      title: `Remove the ${type} integration?`,
      body: 'This deletes the stored credentials for this integration. This cannot be undone.',
      confirmLabel: 'Remove Integration',
      danger: true,
    });
    if (!ok) return false;
    try {
      const res = await apiFetch(`/api/integrations/${type}`, { method: 'DELETE' });
      if (!res.ok) {
        toast(`Failed to delete ${type} (HTTP ${res.status}).`, 'error');
        return false;
      }
      refetch();
      return true;
    } catch (err) {
      toast(`Failed to delete ${type}: ${err.message}`, 'error');
      return false;
    }
  };

  // ── Toggle enabled/disabled ──
  // Sends only the new state: the server changes `enabled` and nothing else
  // in the stored entry (#402).
  const handleToggle = async (type, currentConfig) => {
    const enabled = currentConfig.enabled === false; // flip it
    try {
      const res = await apiFetch(`/api/integrations/${encodeURIComponent(type)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = res.ok ? await res.json().catch(() => ({})) : {};
      if (!res.ok || data.ok === false) {
        toast(`Failed to ${enabled ? 'enable' : 'disable'} ${type}.`, 'error');
        return;
      }
      refetch();
    } catch (err) {
      toast(`Failed to toggle ${type}: ${err.message}`, 'error');
    }
  };

  return {
    testStatus,
    setTestStatus,
    saveStatus,
    setSaveStatus,
    handleTest,
    handleSave,
    handleDelete,
    handleToggle,
  };
}
