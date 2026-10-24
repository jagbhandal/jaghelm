import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import Integrations from './Integrations.jsx';
import { OverlayProvider } from '../../../context/OverlayContext.jsx';
import {
  STATUSPAGE,
  ADGUARD_PRIMARY,
  ADGUARD_SECONDARY,
  CUSTOM_BUILDER,
  ZEROS,
  URL_CREDENTIAL,
} from '../../../../server/routes/fixtures/settingsForm.js';
import { maskCredentials } from '../../../../server/util/configMask.js';

// #402: the server merges a save into the stored entry, and the toggle sets
// only `enabled`. These pin what the form sends for stored entries to the
// fixtures that server/routes/integrations.merge.test.js sends to the real
// routes, so the two sides can't drift apart. The config is served as the
// server answers it (#413): each stored credential is { "$stored": true }.

const PRESETS = [
  {
    type: 'adguard',
    name: 'AdGuard Home',
    icon: 'adguard-home',
    description: '',
    auth: 'basic',
    fields: [],
  },
  {
    type: 'cloudflare',
    name: 'Cloudflare Tunnels',
    icon: 'cloudflare',
    description: '',
    auth: 'bearer',
    fields: [],
    urlParams: [{ key: 'account_id', label: 'Account ID' }],
  },
  {
    type: 'grafana',
    name: 'Grafana',
    icon: 'grafana',
    description: 'Dashboards',
    auth: 'bearer',
    fields: [{ key: 'alerts', label: 'Firing alerts' }],
  },
];

/**
 * A server with the fixture entries. `saveReply(body)` may answer a save
 * itself, as `{ status, body }`; otherwise every save succeeds. `testReply` and
 * `configReply()` may answer a connection test and the config read the same
 * way. `extra` adds stored entries.
 */
function stubServer({ saveReply, testReply, configReply, extra = {} } = {}) {
  const writes = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, opts = {}) => {
      const method = opts.method || 'GET';
      const body = opts.body ? JSON.parse(opts.body) : undefined;
      if (body) writes.push({ method, url, body });
      else if (method !== 'GET') writes.push({ method, url });
      if (url === '/api/integrations/presets') return Response.json(PRESETS);
      if (url === '/api/services/config') {
        const reply = configReply?.();
        if (reply) return Response.json(reply.body, { status: reply.status });
        return Response.json(
          maskCredentials({
            integrations: {
              [STATUSPAGE.key]: STATUSPAGE.entry,
              [ADGUARD_PRIMARY.key]: ADGUARD_PRIMARY.entry,
              [ADGUARD_SECONDARY.key]: ADGUARD_SECONDARY.entry,
              [ZEROS.key]: ZEROS.entry,
              ...extra,
            },
          })
        );
      }
      if (url === '/api/services') {
        return Response.json({
          nodes: {
            pi1: { display_name: 'pi1', services: [{ uid: 'pi1:adguard', container: 'adguard' }] },
          },
        });
      }
      if (url === '/api/integrations/save') {
        const reply = saveReply?.(body);
        if (reply) return Response.json(reply.body, { status: reply.status });
        return Response.json({ ok: true, type: body.editingKey ?? body.type });
      }
      if (url === '/api/integrations/test') {
        const reply = testReply?.(body);
        if (reply) return Response.json(reply.body, { status: reply.status });
        return Response.json({ ok: true });
      }
      return Response.json({ ok: true });
    })
  );
  return writes;
}

/** The configured-integration row whose name is `name`, once the list has loaded. */
async function rowFor(name) {
  const heading = await screen.findByRole('heading', { level: 3, name });
  return heading.closest('[data-slot="integration-row"]');
}

function renderTab(props = {}) {
  return render(
    <OverlayProvider>
      <Integrations {...props} />
    </OverlayProvider>
  );
}

describe('Integrations sends only what it owns (#402)', () => {
  it('Disable on adguard_primary sends { enabled: false } to that key, and nothing else', async () => {
    const writes = stubServer();
    renderTab();
    fireEvent.click(
      within(await rowFor('AdGuard Home (primary)')).getByRole('button', { name: /^Disable / })
    );
    const { method, path, body } = ADGUARD_PRIMARY.disable;
    await waitFor(() => expect(writes).toEqual([{ method, url: path, body }]));
  });

  it('Edit, then Save with nothing changed, sends the fixture body for a hand-written custom entry', async () => {
    const writes = stubServer();
    renderTab();
    fireEvent.click(within(await rowFor('statuspage')).getByRole('button', { name: /^Edit / }));
    fireEvent.click(screen.getByRole('button', { name: /Save integration/ }));
    await waitFor(() =>
      expect(writes).toEqual([
        { method: 'POST', url: '/api/integrations/save', body: STATUSPAGE.saveUnchanged },
      ])
    );
  });

  it('Edit, then Save with nothing changed, sends the fixture body for adguard_primary (password left blank)', async () => {
    const writes = stubServer();
    renderTab();
    fireEvent.click(
      within(await rowFor('AdGuard Home (primary)')).getByRole('button', { name: /^Edit / })
    );
    fireEvent.click(screen.getByRole('button', { name: /Save integration/ }));
    await waitFor(() =>
      expect(writes).toEqual([
        { method: 'POST', url: '/api/integrations/save', body: ADGUARD_PRIMARY.saveUnchanged },
      ])
    );
  });

  it('a stored credential read as { "$stored": true } is not shown, and Save sends none (#413)', async () => {
    const writes = stubServer();
    renderTab();
    fireEvent.click(
      within(await rowFor('AdGuard Home (primary)')).getByRole('button', { name: /^Edit / })
    );
    expect(screen.getByLabelText('Password')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: /Save integration/ }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).not.toHaveProperty('password');
    expect(JSON.stringify(writes)).not.toContain('$stored');
  });

  it('a target set back to auto-match is sent empty, so the server clears it', async () => {
    const writes = stubServer();
    renderTab();
    fireEvent.click(
      within(await rowFor('AdGuard Home (primary)')).getByRole('button', { name: /^Edit / })
    );
    const target = screen.getByRole('combobox', { name: 'Target container' });
    expect(target).toHaveTextContent('adguard — pi1');
    await userEvent.setup().click(target);
    await userEvent
      .setup()
      .click(await screen.findByRole('option', { name: 'Auto-match (by name)' }));
    fireEvent.click(screen.getByRole('button', { name: /Save integration/ }));
    await waitFor(() =>
      expect(writes).toEqual([
        {
          method: 'POST',
          url: '/api/integrations/save',
          body: { ...ADGUARD_PRIMARY.saveUnchanged, target: '' },
        },
      ])
    );
  });

  it('a value that is set but falsy (0) is sent back as it is', async () => {
    const writes = stubServer();
    renderTab();
    fireEvent.click(
      within(await rowFor('Cloudflare Tunnels')).getByRole('button', { name: /^Edit / })
    );
    fireEvent.click(screen.getByRole('button', { name: /Save integration/ }));
    await waitFor(() =>
      expect(writes).toEqual([
        { method: 'POST', url: '/api/integrations/save', body: ZEROS.saveUnchanged },
      ])
    );
  });

  it('an Enabled box changed in the form goes to the toggle route after the save', async () => {
    const writes = stubServer();
    renderTab();
    fireEvent.click(
      within(await rowFor('AdGuard Home (primary)')).getByRole('button', { name: /^Edit / })
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /Enabled/ }));
    fireEvent.click(screen.getByRole('button', { name: /Save integration/ }));
    const { method, path, body } = ADGUARD_PRIMARY.disable;
    await waitFor(() =>
      expect(writes).toEqual([
        { method: 'POST', url: '/api/integrations/save', body: ADGUARD_PRIMARY.saveUnchanged },
        { method, url: path, body },
      ])
    );
  });

  it('a new integration is saved with its Enabled box', async () => {
    const writes = stubServer();
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /Custom integration/ }));
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'http://new.example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save integration/ }));
    await waitFor(() =>
      expect(writes).toEqual([
        {
          method: 'POST',
          url: '/api/integrations/save',
          body: {
            type: '_custom',
            url: 'http://new.example.test',
            enabled: true,
            target: '',
            username: '',
            create: true,
          },
        },
      ])
    );
  });
});

// #414: a save that would land on another integration's key is refused (409),
// and the form shows why next to the field that would have to change.
describe('Integrations shows a refused key beside the Instance Name field (#414)', () => {
  it('renaming adguard_secondary to "primary" sends the fixture body and shows the refusal beside Instance Name', async () => {
    const writes = stubServer({
      saveReply: (body) =>
        body.editingKey === ADGUARD_SECONDARY.key ? ADGUARD_SECONDARY.refused : null,
    });
    renderTab();
    fireEvent.click(
      within(await rowFor('AdGuard Home (secondary)')).getByRole('button', { name: /^Edit / })
    );
    const instance = screen.getByLabelText('Instance name');
    fireEvent.change(instance, { target: { value: 'primary' } });
    fireEvent.click(screen.getByRole('button', { name: /Save integration/ }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(ADGUARD_SECONDARY.refused.body.error);
    expect(writes).toEqual([
      { method: 'POST', url: '/api/integrations/save', body: ADGUARD_SECONDARY.renameToPrimary },
    ]);
    // Beside the field: in its group, and tied to the input for assistive tech.
    expect(alert.closest('[data-slot="field"]')).toBe(instance.closest('[data-slot="field"]'));
    expect(instance.getAttribute('aria-invalid')).toBe('true');
    expect(instance.getAttribute('aria-describedby')).toContain(alert.closest('[id]').id);
    // Shown once: not repeated in the general save error below the buttons.
    expect(screen.queryByText(/Not saved:/)).toBeNull();
    // The form stays open on the refused values, with the field focused, so
    // a form scrolled down to Save brings it into view.
    expect(instance.value).toBe('primary');
    expect(document.activeElement).toBe(instance);
  });

  it('editing Instance Name clears the refusal, and a refused save again focuses it again', async () => {
    stubServer({
      saveReply: (body) =>
        body.editingKey === ADGUARD_SECONDARY.key && body.instance === 'primary'
          ? ADGUARD_SECONDARY.refused
          : null,
    });
    renderTab();
    fireEvent.click(
      within(await rowFor('AdGuard Home (secondary)')).getByRole('button', { name: /^Edit / })
    );
    const instance = screen.getByLabelText('Instance name');
    const saveButton = screen.getByRole('button', { name: /Save integration/ });
    fireEvent.change(instance, { target: { value: 'primary' } });
    fireEvent.click(saveButton);
    await screen.findByRole('alert');

    fireEvent.change(instance, { target: { value: 'primar' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(instance.getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByText(/Not saved:/)).toBeNull();

    // The same name again, saved from the button: refused and focused again.
    fireEvent.change(instance, { target: { value: 'primary' } });
    saveButton.focus();
    fireEvent.click(saveButton);
    expect((await screen.findByRole('alert')).textContent).toBe(
      ADGUARD_SECONDARY.refused.body.error
    );
    expect(document.activeElement).toBe(instance);
  });

  it('a form with no Instance Name field (custom builder) shows the refusal as a save error, announced once', async () => {
    const writes = stubServer({ saveReply: () => CUSTOM_BUILDER.refused });
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /Custom integration/ }));
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: CUSTOM_BUILDER.add.url },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save integration/ }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(`Not saved: ${CUSTOM_BUILDER.refused.body.error}`);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(writes).toEqual([
      { method: 'POST', url: '/api/integrations/save', body: CUSTOM_BUILDER.add },
    ]);
    expect(screen.queryByLabelText('Instance name')).toBeNull();
  });
});

// #427: Test sends what Save sends, so the server tests the form merged into
// the stored entry, as the save would store it.
describe('Integrations tests what it would save (#427)', () => {
  it('Test on a hand-written custom entry sends the fixture save body', async () => {
    const writes = stubServer();
    renderTab();
    fireEvent.click(within(await rowFor('statuspage')).getByRole('button', { name: /^Edit / }));
    fireEvent.click(screen.getByRole('button', { name: /Test connection/ }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Connected: the integration answered.'
    );
    expect(writes).toEqual([
      { method: 'POST', url: '/api/integrations/test', body: STATUSPAGE.saveUnchanged },
    ]);
  });

  it('Test and Save send the same body for an edited preset, a typed password included', async () => {
    const writes = stubServer();
    renderTab();
    fireEvent.click(
      within(await rowFor('AdGuard Home (primary)')).getByRole('button', { name: /^Edit / })
    );
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'typed-pw' } }); // pragma: allowlist secret
    fireEvent.click(screen.getByRole('button', { name: /Test connection/ }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Connected'));
    fireEvent.click(screen.getByRole('button', { name: /Save integration/ }));
    const body = { ...ADGUARD_PRIMARY.saveUnchanged, password: 'typed-pw' }; // pragma: allowlist secret
    await waitFor(() =>
      expect(writes).toEqual([
        { method: 'POST', url: '/api/integrations/test', body },
        { method: 'POST', url: '/api/integrations/save', body },
      ])
    );
  });

  it('a failed test shows the error the refresh would show', async () => {
    stubServer({
      testReply: () => ({ status: 200, body: { ok: false, error: 'HTTP 401 Unauthorized' } }),
    });
    renderTab();
    fireEvent.click(within(await rowFor('statuspage')).getByRole('button', { name: /^Edit / }));
    fireEvent.click(screen.getByRole('button', { name: /Test connection/ }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Test failed: HTTP 401 Unauthorized'
    );
  });
});

// #422: a URL that carries a credential is refused beside the Base URL field,
// and one already stored is read masked and never shown.
describe('Integrations and a credential to re-enter for a new address (#556)', () => {
  const cases = [
    { row: 'AdGuard Home (primary)', label: 'Password', field: 'password' },
    { row: 'statuspage', label: 'API token', field: 'token' },
  ];
  for (const { row, label, field } of cases) {
    for (const button of [/Save integration/, /Test connection/]) {
      it(`a refused ${button.source.split(' ')[0]} for the ${field} shows beside it, focused, until it is typed`, async () => {
        const refused = {
          status: 400,
          body: {
            error: `The stored ${field} was entered for the old address; re-enter the ${field} for the new address`,
            field,
          },
        };
        stubServer({
          saveReply: () => refused,
          testReply: () => ({ ...refused, body: { ok: false, ...refused.body } }),
        });
        renderTab();
        fireEvent.click(within(await rowFor(row)).getByRole('button', { name: /^Edit / }));
        fireEvent.change(screen.getByLabelText('Base URL'), {
          target: { value: 'http://elsewhere.example.test' },
        });
        fireEvent.click(screen.getByRole('button', { name: button }));

        const input = screen.getByLabelText(label);
        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toBe(refused.body.error);
        expect(alert.closest('[data-slot="field"]')).toBe(input.closest('[data-slot="field"]'));
        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect(document.activeElement).toBe(input);
        expect(screen.getAllByRole('alert')).toHaveLength(1);
        expect(screen.queryByText(/Not saved:|Test failed:/)).toBeNull();

        fireEvent.change(input, { target: { value: 'typed-again' } }); // pragma: allowlist secret
        expect(screen.queryByRole('alert')).toBeNull();
      });
    }
  }
});

describe('Integrations and a credential in the URL (#422)', () => {
  for (const button of [/Save integration/, /Test connection/]) {
    it(`a refused ${button.source.split(' ')[0]} shows the message beside Base URL, focused, until the URL is edited`, async () => {
      stubServer({
        saveReply: () => URL_CREDENTIAL.refused,
        testReply: () => URL_CREDENTIAL.refused,
      });
      renderTab();
      fireEvent.click(
        within(await rowFor('AdGuard Home (primary)')).getByRole('button', { name: /^Edit / })
      );
      const url = screen.getByLabelText('Base URL');
      fireEvent.change(url, { target: { value: 'http://admin:pw@adguard.example.test:3000' } }); // pragma: allowlist secret
      fireEvent.click(screen.getByRole('button', { name: button }));

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe(URL_CREDENTIAL.refused.body.error);
      expect(alert.closest('[data-slot="field"]')).toBe(url.closest('[data-slot="field"]'));
      expect(url.getAttribute('aria-invalid')).toBe('true');
      expect(url.getAttribute('aria-describedby')).toContain(alert.closest('[id]').id);
      expect(document.activeElement).toBe(url);
      // Shown once, beside the field: not as a save error or a test result too.
      expect(screen.getAllByRole('alert')).toHaveLength(1);
      expect(screen.queryByText(/Not saved:|Test failed:/)).toBeNull();

      fireEvent.change(url, { target: { value: 'http://adguard.example.test:3000' } });
      expect(screen.queryByRole('alert')).toBeNull();
      expect(url.getAttribute('aria-invalid')).toBeNull();
    });
  }

  it('a stored URL with a credential is not shown: the row says so, and the form starts empty with a note', async () => {
    const writes = stubServer({
      extra: {
        withkey: {
          url: 'http://status.example.test/?apikey=k', // pragma: allowlist secret
          endpoint: '/api',
          fields: [],
        },
      },
    });
    renderTab();
    const row = await rowFor('withkey');
    expect(row.textContent).toContain('address not shown: it carries a credential');
    expect(row.textContent).not.toContain('apikey');

    fireEvent.click(within(row).getByRole('button', { name: /^Edit / }));
    const url = screen.getByLabelText('Base URL');
    expect(url).toHaveValue('');
    expect(screen.getByRole('alert').textContent).toMatch(/stored URL carries a password or key/);
    expect(screen.getByRole('button', { name: /Test connection/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Save integration/ })).toBeDisabled();

    fireEvent.change(url, { target: { value: 'http://status.example.test' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Save integration/ }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual({
      type: 'withkey',
      url: 'http://status.example.test',
      target: '',
      username: '',
      editingKey: 'withkey',
    });
  });
});

describe('Integrations when services.yaml cannot be read (#423)', () => {
  const BROKEN = "services.yaml doesn't parse (line 4): fix it by hand; JagHelm won't save over it";

  it('says why instead of an empty list, and lists the integrations once it is fixed', async () => {
    let broken = true;
    stubServer({
      configReply: () =>
        broken ? { status: 503, body: { error: BROKEN, code: 'config_unparseable' } } : null,
    });
    renderTab();
    expect(await screen.findByText(BROKEN)).toBeInTheDocument();
    expect(screen.queryByText('No integrations yet')).not.toBeInTheDocument();
    expect(screen.queryByText('AdGuard Home (primary)')).not.toBeInTheDocument();

    broken = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('AdGuard Home (primary)')).toBeInTheDocument();
    expect(screen.queryByText(BROKEN)).not.toBeInTheDocument();
  });

  it("one that can't be read says why, unprefixed, as one that doesn't parse (#536)", async () => {
    const UNREADABLE =
      "services.yaml can't be read (permission denied): fix it on the host; JagHelm won't save over a file it can't read";
    stubServer({
      configReply: () => ({ status: 503, body: { error: UNREADABLE, code: 'config_unreadable' } }),
    });
    renderTab();
    expect(await screen.findByText(UNREADABLE)).toBeInTheDocument();
    expect(screen.queryByText('No integrations yet')).not.toBeInTheDocument();
  });

  it('a config read that fails another way says so too, not an empty list', async () => {
    stubServer({ configReply: () => ({ status: 500, body: { error: 'Internal server error' } }) });
    renderTab();
    expect(
      await screen.findByText("Couldn't read the config: Internal server error")
    ).toBeInTheDocument();
    expect(screen.queryByText('No integrations yet')).not.toBeInTheDocument();
  });
});

// #323: removing asks first, in the Confirm dialog, by display name.
describe('Integrations asks before removing, by display name (#323)', () => {
  it('Remove on a row names it by its display name, and deletes nothing until confirmed', async () => {
    const writes = stubServer();
    const user = userEvent.setup();
    renderTab();
    const row = await rowFor('AdGuard Home (primary)');
    await user.click(within(row).getByRole('button', { name: 'Remove AdGuard Home (primary)' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('AdGuard Home (primary)');
    expect(dialog.textContent).not.toContain('adguard_primary');
    expect(writes).toEqual([]);

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(writes).toEqual([]);

    await user.click(within(row).getByRole('button', { name: 'Remove AdGuard Home (primary)' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Remove integration',
      })
    );
    await waitFor(() =>
      expect(writes).toEqual([{ method: 'DELETE', url: '/api/integrations/adguard_primary' }])
    );
  });

  it('Remove in the edit form asks the same way, and returns to the list once removed', async () => {
    const writes = stubServer();
    const user = userEvent.setup();
    renderTab();
    fireEvent.click(
      within(await rowFor('AdGuard Home (secondary)')).getByRole('button', { name: /^Edit / })
    );
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('AdGuard Home (secondary)');
    expect(writes).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Remove integration' }));
    await waitFor(() =>
      expect(writes).toEqual([{ method: 'DELETE', url: '/api/integrations/adguard_secondary' }])
    );
    expect(await screen.findByRole('heading', { level: 2, name: 'Connected' })).toBeInTheDocument();
  });

  it('a failed removal says so by the display name, not the key', async () => {
    const user = userEvent.setup();
    stubServer();
    const fetchMock = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url, opts = {}) =>
      opts.method === 'DELETE' ? new Response('{}', { status: 500 }) : fetchMock(url, opts)
    );
    renderTab();
    const row = await rowFor('AdGuard Home (primary)');
    await user.click(within(row).getByRole('button', { name: 'Remove AdGuard Home (primary)' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Remove integration',
      })
    );
    const toast = await screen.findByText(/Failed to remove/);
    expect(toast.textContent).toBe('Failed to remove AdGuard Home (primary) (HTTP 500).');
  });
});

// #323: a row is the preset its entry says, else custom; it never guesses from the key.
describe('Integrations shows what an entry says, and Custom when it says nothing (#323)', () => {
  it('a key with an underscore and no preset is custom, a key that is a preset type is that preset', async () => {
    stubServer({
      extra: {
        my_api: { url: 'http://my.example.test' },
        adguard: { url: 'http://plain.example.test:3000' },
        adguard_extra: { url: 'http://extra.example.test:3000' },
      },
    });
    renderTab();
    const custom = await rowFor('my_api');
    expect(custom).toHaveTextContent('Custom');
    expect(custom).not.toHaveTextContent('Preset');
    const plain = await rowFor('AdGuard Home');
    expect(plain).toHaveTextContent('Preset');
    // Named adguard_extra but saying no preset: the server runs it as custom too.
    expect(await rowFor('adguard_extra')).toHaveTextContent('Custom');
  });

  it('a custom entry written with an endpoint and fields says they are set in services.yaml, in the row and the form', async () => {
    stubServer();
    renderTab();
    const row = await rowFor('statuspage');
    expect(row).toHaveTextContent('Endpoint and fields are set in services.yaml.');
    fireEvent.click(within(row).getByRole('button', { name: /^Edit / }));
    expect(
      screen.getByText('It has an endpoint and 1 data field, set in services.yaml on the host.', {
        exact: false,
      })
    ).toBeInTheDocument();
  });

  it('a new custom integration says its endpoint and fields come from services.yaml', async () => {
    stubServer();
    renderTab();
    await rowFor('statuspage');
    fireEvent.click(screen.getAllByRole('button', { name: /Custom integration/ })[0]);
    expect(screen.getByText('Endpoint and fields are set in services.yaml')).toBeInTheDocument();
  });
});

describe('Integrations shows each integration’s live status from the board’s (#323)', () => {
  const status = {
    entities: [
      { id: 'integrations/adguard_primary', state: 'ok', word: 'OK', reason: 'OK' },
      {
        id: 'integrations/statuspage',
        state: 'warn',
        word: 'Failing',
        reason: 'statuspage: its address refused the connection',
      },
    ],
  };

  it('a row takes the model’s word and, when it is failing, its reason; a disabled one is not fetched', async () => {
    stubServer({ extra: { off: { url: 'http://off.example.test', enabled: false } } });
    renderTab({ status, reach: 'ok', updated: null });
    const failing = await rowFor('statuspage');
    expect(failing).toHaveTextContent('Failing');
    expect(failing).toHaveTextContent('statuspage: its address refused the connection');
    expect(await rowFor('AdGuard Home (primary)')).toHaveTextContent('OK');
    const off = await rowFor('off');
    expect(off).toHaveTextContent('Disabled');
    expect(within(off).getByRole('button', { name: 'Enable off' })).toBeInTheDocument();
  });
});

describe('Integrations never shows a secret (#323)', () => {
  it('a typed password is a password field, and a test result or refusal that echoes it has it blanked', async () => {
    const typed = 'hunter2-typed'; // pragma: allowlist secret
    stubServer({
      testReply: () => ({
        status: 200,
        body: { ok: false, error: `401 for password ${typed} at the login` },
      }),
    });
    renderTab();
    fireEvent.click(
      within(await rowFor('AdGuard Home (primary)')).getByRole('button', { name: /^Edit / })
    );
    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveValue('');
    fireEvent.change(password, { target: { value: typed } });
    fireEvent.click(screen.getByRole('button', { name: /Test connection/ }));
    const result = await screen.findByRole('status');
    await waitFor(() => expect(result).toHaveTextContent('Test failed'));
    expect(result.textContent).not.toContain(typed);
    expect(result).toHaveTextContent('401 for password •••• at the login');
  });
});

describe('Integrations’ gallery (#323)', () => {
  it('searches and filters the presets, marks a set-up one, and a pick opens its form', async () => {
    stubServer();
    const user = userEvent.setup();
    renderTab();
    await rowFor('statuspage');
    const gallery = screen.getByRole('region', { name: 'Add an integration' });
    expect(within(gallery).getByRole('button', { name: /AdGuard Home/ })).toHaveTextContent(
      'Set up'
    );
    expect(within(gallery).getByRole('button', { name: /Grafana/ })).not.toHaveTextContent(
      'Set up'
    );
    await user.type(within(gallery).getByRole('searchbox', { name: 'Search presets' }), 'graf');
    expect(within(gallery).queryByRole('button', { name: /AdGuard Home/ })).toBeNull();
    await user.clear(within(gallery).getByRole('searchbox'));
    await user.type(within(gallery).getByRole('searchbox'), 'zzz');
    expect(within(gallery).getByText('No presets match that search.')).toBeInTheDocument();
    await user.clear(within(gallery).getByRole('searchbox'));
    await user.click(within(gallery).getByRole('button', { name: /Grafana/ }));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Configure Grafana' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('API token')).toHaveAttribute('type', 'password');
    expect(screen.getByText('Firing alerts')).toBeInTheDocument();
  });
});
