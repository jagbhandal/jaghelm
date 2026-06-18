import { useState } from 'react';
import { apiFetch } from '../../../api/client.js';

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
      if (form.instance.trim()) body.instance = form.instance.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (form.target) body.target = form.target;
      if (form.username) body.username = form.username;
      if (form.password) body.password = form.password;
      if (form.token) body.token = form.token;
      if (Object.keys(form.params).length > 0) body.params = form.params;
      // When editing, send the original storage key so server can remove it if the key changed
      if (editingType) body.editingKey = editingType;

      const res = await apiFetch('/api/integrations/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setSaveStatus('saved');
        setTimeout(() => { onAfterSave?.(); }, 800);
      } else {
        setSaveStatus({ error: data.error || 'Save failed' });
      }
    } catch (err) {
      setSaveStatus({ error: err.message });
    }
  };

  // ── Delete integration ──
  const handleDelete = async (type) => {
    if (!confirm(`Remove ${type} integration? This will delete stored credentials.`)) return;
    try {
      await apiFetch(`/api/integrations/${type}`, { method: 'DELETE' });
      refetch();
    } catch {
      // Silently fail
    }
  };

  // ── Toggle enabled/disabled ──
  const handleToggle = async (type, currentConfig) => {
    try {
      const body = {
        type,
        url: currentConfig.url,
        enabled: currentConfig.enabled === false, // flip it
      };
      if (currentConfig.username) body.username = currentConfig.username;
      // Don't send password/token — they're already stored as $secret refs
      await apiFetch('/api/integrations/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      refetch();
    } catch {
      // Silently fail
    }
  };

  return {
    testStatus, setTestStatus,
    saveStatus, setSaveStatus,
    handleTest, handleSave, handleDelete, handleToggle,
  };
}
