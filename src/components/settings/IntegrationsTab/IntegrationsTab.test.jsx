import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import IntegrationsTab from './IntegrationsTab.jsx';
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
      const body = method === 'GET' ? undefined : JSON.parse(opts.body);
      if (body) writes.push({ method, url, body });
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
  const label = await screen.findByText(name);
  return label.parentElement.parentElement;
}

function renderTab() {
  render(
    <OverlayProvider>
      <IntegrationsTab />
    </OverlayProvider>
  );
}

describe('IntegrationsTab sends only what it owns (#402)', () => {
  it('Disable on adguard_primary sends { enabled: false } to that key, and nothing else', async () => {
    const writes = stubServer();
    renderTab();
    fireEvent.click(
      within(await rowFor('AdGuard Home (primary)')).getByRole('button', { name: 'Disable' })
    );
    const { method, path, body } = ADGUARD_PRIMARY.disable;
    await waitFor(() => expect(writes).toEqual([{ method, url: path, body }]));
  });

  it('Edit, then Save with nothing changed, sends the fixture body for a hand-written custom entry', async () => {
    const writes = stubServer();
    renderTab();
    fireEvent.click(within(await rowFor('statuspage')).getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: /Save Integration/ }));
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
      within(await rowFor('AdGuard Home (primary)')).getByRole('button', { name: 'Edit' })
    );
    fireEvent.click(screen.getByRole('button', { name: /Save Integration/ }));
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
      within(await rowFor('AdGuard Home (primary)')).getByRole('button', { name: 'Edit' })
    );
    expect(screen.getByLabelText('Password')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: /Save Integration/ }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).not.toHaveProperty('password');
    expect(JSON.stringify(writes)).not.toContain('$stored');
  });

  it('a target set back to auto-match is sent empty, so the server clears it', async () => {
    const writes = stubServer();
    renderTab();
    fireEvent.click(
      within(await rowFor('AdGuard Home (primary)')).getByRole('button', { name: 'Edit' })
    );
    fireEvent.change(screen.getByLabelText('Target Container'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Integration/ }));
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
      within(await rowFor('Cloudflare Tunnels')).getByRole('button', { name: 'Edit' })
    );
    fireEvent.click(screen.getByRole('button', { name: /Save Integration/ }));
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
      within(await rowFor('AdGuard Home (primary)')).getByRole('button', { name: 'Edit' })
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /Enabled/ }));
    fireEvent.click(screen.getByRole('button', { name: /Save Integration/ }));
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
    fireEvent.click(await screen.findByRole('button', { name: '+ Custom Integration' }));
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'http://new.example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save Integration/ }));
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
describe('IntegrationsTab shows a refused key beside the Instance Name field (#414)', () => {
  it('renaming adguard_secondary to "primary" sends the fixture body and shows the refusal beside Instance Name', async () => {
    const writes = stubServer({
      saveReply: (body) =>
        body.editingKey === ADGUARD_SECONDARY.key ? ADGUARD_SECONDARY.refused : null,
    });
    renderTab();
    fireEvent.click(
      within(await rowFor('AdGuard Home (secondary)')).getByRole('button', { name: 'Edit' })
    );
    const instance = screen.getByLabelText('Instance Name');
    fireEvent.change(instance, { target: { value: 'primary' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Integration/ }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(ADGUARD_SECONDARY.refused.body.error);
    expect(writes).toEqual([
      { method: 'POST', url: '/api/integrations/save', body: ADGUARD_SECONDARY.renameToPrimary },
    ]);
    // Beside the field: in its group, and tied to the input for assistive tech.
    expect(alert.parentElement).toBe(instance.parentElement);
    expect(instance.getAttribute('aria-invalid')).toBe('true');
    expect(instance.getAttribute('aria-describedby')).toBe(alert.id);
    // Shown once: not repeated in the general save error below the buttons.
    expect(screen.queryByText(/Save error:/)).toBeNull();
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
      within(await rowFor('AdGuard Home (secondary)')).getByRole('button', { name: 'Edit' })
    );
    const instance = screen.getByLabelText('Instance Name');
    const saveButton = screen.getByRole('button', { name: /Save Integration/ });
    fireEvent.change(instance, { target: { value: 'primary' } });
    fireEvent.click(saveButton);
    await screen.findByRole('alert');

    fireEvent.change(instance, { target: { value: 'primar' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(instance.getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByText(/Save error:/)).toBeNull();

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
    fireEvent.click(await screen.findByRole('button', { name: '+ Custom Integration' }));
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: CUSTOM_BUILDER.add.url },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save Integration/ }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(`Save error: ${CUSTOM_BUILDER.refused.body.error}`);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(writes).toEqual([
      { method: 'POST', url: '/api/integrations/save', body: CUSTOM_BUILDER.add },
    ]);
    expect(screen.queryByLabelText('Instance Name')).toBeNull();
  });
});

// #427: Test sends what Save sends, so the server tests the form merged into
// the stored entry, as the save would store it.
describe('IntegrationsTab tests what it would save (#427)', () => {
  it('Test on a hand-written custom entry sends the fixture save body', async () => {
    const writes = stubServer();
    renderTab();
    fireEvent.click(within(await rowFor('statuspage')).getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: /Test Connection/ }));
    expect(await screen.findByText('✓ Connection successful')).toBeInTheDocument();
    expect(writes).toEqual([
      { method: 'POST', url: '/api/integrations/test', body: STATUSPAGE.saveUnchanged },
    ]);
  });

  it('Test and Save send the same body for an edited preset, a typed password included', async () => {
    const writes = stubServer();
    renderTab();
    fireEvent.click(
      within(await rowFor('AdGuard Home (primary)')).getByRole('button', { name: 'Edit' })
    );
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'typed-pw' } }); // pragma: allowlist secret
    fireEvent.click(screen.getByRole('button', { name: /Test Connection/ }));
    await screen.findByText('✓ Connection successful');
    fireEvent.click(screen.getByRole('button', { name: /Save Integration/ }));
    const body = { ...ADGUARD_PRIMARY.saveUnchanged, password: 'typed-pw' }; // pragma: allowlist secret
    await waitFor(() =>
      expect(writes).toEqual([
        { method: 'POST', url: '/api/integrations/test', body },
        { method: 'POST', url: '/api/integrations/save', body },
      ])
    );
  });

  it('a failed test shows the error the refresh would show', async () => {
    stubServer({ testReply: () => ({ status: 200, body: { ok: false, error: 'HTTP 401 Unauthorized' } }) });
    renderTab();
    fireEvent.click(within(await rowFor('statuspage')).getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: /Test Connection/ }));
    expect(
      await screen.findByText('✕ Connection failed: HTTP 401 Unauthorized')
    ).toBeInTheDocument();
  });
});

// #422: a URL that carries a credential is refused beside the Base URL field,
// and one already stored is read masked and never shown.
describe('IntegrationsTab and a credential in the URL (#422)', () => {
  for (const button of [/Save Integration/, /Test Connection/]) {
    it(`a refused ${button.source.split(' ')[0]} shows the message beside Base URL, focused, until the URL is edited`, async () => {
      stubServer({ saveReply: () => URL_CREDENTIAL.refused, testReply: () => URL_CREDENTIAL.refused });
      renderTab();
      fireEvent.click(
        within(await rowFor('AdGuard Home (primary)')).getByRole('button', { name: 'Edit' })
      );
      const url = screen.getByLabelText('Base URL');
      fireEvent.change(url, { target: { value: 'http://admin:pw@adguard.example.test:3000' } }); // pragma: allowlist secret
      fireEvent.click(screen.getByRole('button', { name: button }));

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe(URL_CREDENTIAL.refused.body.error);
      expect(alert.parentElement).toBe(url.parentElement);
      expect(url.getAttribute('aria-invalid')).toBe('true');
      expect(url.getAttribute('aria-describedby')).toBe(alert.id);
      expect(document.activeElement).toBe(url);
      // Shown once, beside the field: not as a save error or a test result too.
      expect(screen.getAllByRole('alert')).toHaveLength(1);
      expect(screen.queryByText(/Save error:|Connection failed:/)).toBeNull();

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
    expect(row.textContent).toContain('URL not shown: it carries a credential');
    expect(row.textContent).not.toContain('apikey');

    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    const url = screen.getByLabelText('Base URL');
    expect(url).toHaveValue('');
    expect(screen.getByRole('alert').textContent).toMatch(/stored URL carries a password or key/);
    expect(screen.getByRole('button', { name: /Test Connection/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Save Integration/ })).toBeDisabled();

    fireEvent.change(url, { target: { value: 'http://status.example.test' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Save Integration/ }));
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

describe('IntegrationsTab when services.yaml cannot be read (#423)', () => {
  const BROKEN =
    "services.yaml doesn't parse (line 4): fix it by hand; JagHelm won't save over it";

  it('says why instead of an empty list, and lists the integrations once it is fixed', async () => {
    let broken = true;
    stubServer({
      configReply: () =>
        broken ? { status: 503, body: { error: BROKEN, code: 'config_unparseable' } } : null,
    });
    renderTab();
    expect(await screen.findByText(BROKEN)).toBeInTheDocument();
    expect(screen.queryByText('No integrations configured yet')).not.toBeInTheDocument();
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
    expect(screen.queryByText('No integrations configured yet')).not.toBeInTheDocument();
  });

  it('a config read that fails another way says so too, not an empty list', async () => {
    stubServer({ configReply: () => ({ status: 500, body: { error: 'Internal server error' } }) });
    renderTab();
    expect(
      await screen.findByText("Couldn't read the config: Internal server error")
    ).toBeInTheDocument();
    expect(screen.queryByText('No integrations configured yet')).not.toBeInTheDocument();
  });
});
