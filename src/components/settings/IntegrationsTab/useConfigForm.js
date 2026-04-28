import { useState } from 'react';

/**
 * useConfigForm — owns the config-form state (URL, credentials, instance name,
 * target container, enabled flag, and per-preset URL params). Exposes a
 * populate(preset, existingConfig) helper used when entering edit/create flow.
 *
 * Passwords/tokens are never prefilled — the populate helper always blanks them
 * and the server treats blank as "keep existing".
 */
export function useConfigForm() {
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [params, setParams] = useState({});
  const [instance, setInstance] = useState('');
  const [target, setTarget] = useState('');

  const populate = (preset, existingConfig) => {
    setUrl(existingConfig?.url || '');
    setUsername(existingConfig?.username || '');
    setPassword(''); // Never prefill passwords
    setToken('');    // Never prefill tokens
    setEnabled(existingConfig?.enabled !== false);
    setInstance(existingConfig?.instance || '');
    setTarget(existingConfig?.target || '');
    // Load URL params from existing config
    const newParams = {};
    for (const p of (preset?.urlParams || [])) {
      newParams[p.key] = existingConfig?.[p.key] || '';
    }
    setParams(newParams);
  };

  return {
    url, setUrl,
    username, setUsername,
    password, setPassword,
    token, setToken,
    enabled, setEnabled,
    params, setParams,
    instance, setInstance,
    target, setTarget,
    populate,
  };
}
