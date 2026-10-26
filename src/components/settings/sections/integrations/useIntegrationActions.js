import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../../api/client.js';
import { useToast } from '../../../../context/OverlayContext.jsx';

/**
 * Defence in depth, not the barrier: the server never puts a credential in a
 * test result or a refusal (and a stored one is never read back). Should one
 * with the password or token typed in this form turn up in the text anyway,
 * it is replaced by bullets here.
 *
 * What is blanked, for each typed secret of four characters or more, in any
 * letter case: the secret as typed; as `encodeURIComponent` writes it (also with `+` for a
 * space) and as JSON writes it inside a string (`"` as `\"`, `\` doubled),
 * the encoded forms in either case of their hex digits. Not blanked: a
 * truncated or partial echo, a hash or base64 of it, or a secret of fewer
 * than four characters. `text` that is not a string is returned as it is.
 */
export function scrubSecrets(text, secrets) {
  if (typeof text !== 'string') return text;
  const forms = new Set();
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length < 4) continue;
    const uri = encodeURIComponent(secret);
    forms.add(secret);
    forms.add(JSON.stringify(secret).slice(1, -1));
    forms.add(uri);
    forms.add(uri.replace(/%20/g, '+'));
  }
  // Longest first, so a form that holds a shorter one is blanked whole.
  let out = text;
  for (const form of [...forms].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '••••');
  }
  return out;
}

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
 *   nameOf          — (storageKey) => the integration's display name, for the
 *                     toasts: a storage key is never shown (#323)
 *
 * Removing asks first, in the Confirm dialog the list and the form draw
 * (src/ui/integrations.jsx), so handleDelete here only deletes.
 */
export function useIntegrationActions({
  selectedPreset,
  editingType,
  form,
  refetch,
  onAfterSave,
  nameOf = (key) => key,
}) {
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

  // A typed password or token is never shown back: a refusal or a test result
  // that quotes one (a server that echoes its input) has it blanked (#323).
  const scrub = (text) => scrubSecrets(text, [form.password, form.token]);

  // ── Test connection ──
  // The answer is { ok: true } or { ok: false, error, field? }: `field`
  // names the form field a refusal belongs beside ('url', 'instance',
  // 'password', 'token').
  const handleTest = async () => {
    setTestStatus('testing');
    try {
      const res = await apiFetch('/api/integrations/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formBody()),
      });
      const data = await res.json().catch(() => ({}));
      // A refusal (400, 401, 5xx) is a failed test whatever its body says (#348).
      if (!res.ok) {
        setTestStatus({ ...data, ok: false, error: scrub(data.error) || `Test failed (HTTP ${res.status})` });
        return;
      }
      setTestStatus(data.ok ? data : { ...data, error: scrub(data.error) });
    } catch (err) {
      setTestStatus({ ok: false, error: scrub(err.message) });
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
      const data = await res.json().catch(() => ({}));
      // A refusal (400, 401, 5xx) is not a save, whatever its body says (#348):
      // the form stays open and unsaved, with the server's words.
      if (!res.ok) {
        setSaveStatus({
          error: scrub(data.error) || `Save failed (HTTP ${res.status})`,
          field: data.field,
        });
        return;
      }
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
        // the URL carries a credential (#422), 'password' or 'token' when it
        // is to be typed again for a new address (#556).
        setSaveStatus({ error: scrub(data.error) || 'Save failed', field: data.field });
      }
    } catch (err) {
      setSaveStatus({ error: scrub(err.message) });
    }
  };

  // ── Delete integration ──
  // Returns true only when the delete succeeded, so callers (the form) leave
  // only on a real deletion. A failed request surfaces a toast, by the
  // integration's display name, instead of silently leaving the UI stale.
  const handleDelete = async (type) => {
    const name = nameOf(type);
    try {
      const res = await apiFetch(`/api/integrations/${encodeURIComponent(type)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        toast(`Failed to remove ${name} (HTTP ${res.status}).`, 'error');
        return false;
      }
      refetch();
      return true;
    } catch (err) {
      toast(`Failed to remove ${name}: ${err.message}`, 'error');
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
        toast(`Failed to ${enabled ? 'enable' : 'disable'} ${nameOf(type)}.`, 'error');
        return;
      }
      refetch();
    } catch (err) {
      toast(`Failed to ${enabled ? 'enable' : 'disable'} ${nameOf(type)}: ${err.message}`, 'error');
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
