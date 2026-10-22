import { useEffect, useRef, useState } from 'react';
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
  // The post-save call waits 800 ms so "Saved" shows first. A tab closed
  // before then gets no call (#459), and a second save restarts the wait.
  const afterSaveTimer = useRef(null);
  useEffect(() => () => clearTimeout(afterSaveTimer.current), []);

  // What Save sends, and Test too (#427): the server merges it into the
  // stored entry, and the test tests what the save would store.
  const formBody = () => {
    const body = {
      type: selectedPreset?.type || editingType || '_custom',
      url: form.url,
    };
    // A new integration is saved with its Enabled box. An edit leaves
    // `enabled` to the toggle route (below), so a form left open can't undo
    // a toggle made elsewhere since (#402).
    if (!editingType) body.enabled = form.enabled;
    // And it says it is new, so the server refuses it, rather than merging
    // it into another integration, when its key is taken (#414).
    if (!editingType) body.create = true;
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
    return body;
  };

  // ── Test connection ──
  // The answer is { ok: true } or { ok: false, error, field? }: `field`
  // names the form field a refusal belongs beside ('url', 'instance').
  const handleTest = async () => {
    setTestStatus('testing');
    try {
      const res = await apiFetch('/api/integrations/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formBody()),
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
      const res = await apiFetch('/api/integrations/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formBody()),
      });
      const data = await res.json();
      if (data.ok && editingType && form.enabled !== form.enabledAtOpen) {
        const toggled = await apiFetch(`/api/integrations/${encodeURIComponent(data.type)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: form.enabled }),
        });
        if (!toggled.ok) {
          setSaveStatus({
            error: `Saved, but could not ${form.enabled ? 'enable' : 'disable'} it (HTTP ${toggled.status})`,
          });
          return;
        }
      }
      if (data.ok) {
        setSaveStatus('saved');
        clearTimeout(afterSaveTimer.current);
        afterSaveTimer.current = setTimeout(() => {
          onAfterSave?.();
        }, 800);
      } else {
        // `field` names the form field the error belongs to: 'instance' when
        // the key it would take is another integration's (#414), 'url' when
        // the URL carries a credential (#422).
        setSaveStatus({ error: data.error || 'Save failed', field: data.field });
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
