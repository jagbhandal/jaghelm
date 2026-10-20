/**
 * What the web app's Integrations settings send for two stored entries (#402),
 * pinned on both sides so neither can drift: IntegrationsTab.test.jsx checks
 * that the form sends exactly these requests for these entries, and
 * routes/integrations.merge.test.js sends them to the real routes.
 *
 * Test-only: nothing at runtime imports this (.dockerignore leaves it out).
 */

/** A custom integration written by hand in services.yaml. */
export const STATUSPAGE = Object.freeze({
  key: 'statuspage',
  entry: {
    url: 'http://status.example.test',
    endpoint: '/api/summary',
    auth: 'header',
    authHeader: 'X-Api-Key',
    token: '$secret:statuspage_key', // pragma: allowlist secret
    fields: [{ key: 'up', label: 'Up', path: 'summary.up' }],
  },
  /**
   * Edit, then Save with nothing changed. An edit sends no `enabled`: a
   * changed Enabled box goes to the toggle route after the save.
   */
  saveUnchanged: {
    type: 'statuspage',
    url: 'http://status.example.test',
    target: '',
    username: '',
    editingKey: 'statuspage',
  },
});

/** A second AdGuard, added from the gallery with an instance name. */
export const ADGUARD_PRIMARY = Object.freeze({
  key: 'adguard_primary',
  entry: {
    preset: 'adguard',
    instance: 'primary',
    url: 'http://adguard.example.test:3000',
    username: 'admin',
    password: '$secret:integration_adguard_primary_password', // pragma: allowlist secret
    target: 'pi1:adguard',
  },
  /** The Disable button on its row. */
  disable: {
    method: 'PATCH',
    path: '/api/integrations/adguard_primary',
    body: { enabled: false },
  },
  /** Edit, then Save with nothing changed: the password field is left blank. */
  saveUnchanged: {
    type: 'adguard',
    url: 'http://adguard.example.test:3000',
    instance: 'primary',
    target: 'pi1:adguard',
    username: 'admin',
    editingKey: 'adguard_primary',
  },
});

/**
 * Values that are set but falsy, which the form used to show as empty and an
 * unchanged save then removed.
 */
export const ZEROS = Object.freeze({
  key: 'cloudflare',
  entry: {
    preset: 'cloudflare',
    url: 'https://api.cloudflare.com',
    username: 0,
    target: 0,
    account_id: 0,
  },
  /** Edit, then Save with nothing changed. */
  saveUnchanged: {
    type: 'cloudflare',
    url: 'https://api.cloudflare.com',
    target: 0,
    username: 0,
    params: { account_id: 0 },
    editingKey: 'cloudflare',
  },
});
