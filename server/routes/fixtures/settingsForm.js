/**
 * What the web app's Integrations settings send for two stored entries (#402),
 * pinned on both sides so neither can drift: IntegrationsTab.test.jsx checks
 * that the form sends exactly these requests for these entries, and
 * routes/integrations.merge.test.js sends them to the real routes. The Test
 * button sends what Save sends (#427), so routes/integrations.connectionTest
 * .test.js sends the save bodies to the test route.
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
 * A third AdGuard, whose instance name is then changed to the second one's
 * (#414). The server refuses that save with `refused`, and the form shows its
 * message beside the Instance Name field.
 */
export const ADGUARD_SECONDARY = Object.freeze({
  key: 'adguard_secondary',
  entry: {
    preset: 'adguard',
    instance: 'secondary',
    url: 'http://adguard2.example.test:3000',
    username: 'admin',
    password: '$secret:integration_adguard_secondary_password', // pragma: allowlist secret
  },
  /** Edit, change Instance Name to "primary", then Save. */
  renameToPrimary: {
    type: 'adguard',
    url: 'http://adguard2.example.test:3000',
    instance: 'primary',
    target: '',
    username: 'admin',
    editingKey: 'adguard_secondary',
  },
  refused: {
    status: 409,
    body: {
      error:
        "AdGuard Home (primary) already uses the key 'adguard_primary'; choose another instance name",
      field: 'instance',
    },
  },
});

/**
 * The custom builder adding a second custom integration (#414). It has no
 * Instance Name field and always derives `_custom`, so with one stored there
 * the save is refused with `refused`, which the form shows as a save error.
 */
export const CUSTOM_BUILDER = Object.freeze({
  key: '_custom',
  entry: { url: 'http://first.example.test' },
  /** + Custom Integration, a Base URL, then Save. */
  add: {
    type: '_custom',
    url: 'http://second.example.test',
    enabled: true,
    target: '',
    username: '',
    create: true,
  },
  refused: {
    status: 409,
    body: {
      error: "A custom integration is already saved under '_custom'; edit or remove it first",
      field: 'instance',
    },
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

/**
 * A URL that carries a credential (#422), here `http://admin:<password>@…`
 * for AdGuard (basic auth): Save and Test are refused with `refused`, and the
 * form shows its message beside the Base URL field. The message names where
 * the credential goes, never the value.
 */
export const URL_CREDENTIAL = Object.freeze({
  refused: {
    status: 400,
    body: {
      error:
        "The URL can't carry a user name or password. Remove it, and put the user name and password in the Username and Password fields.",
      field: 'url',
    },
  },
});
