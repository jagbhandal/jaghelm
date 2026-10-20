import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import IntegrationsTab from './IntegrationsTab.jsx';
import { OverlayProvider } from '../../../context/OverlayContext.jsx';
import {
  STATUSPAGE,
  ADGUARD_PRIMARY,
  ZEROS,
} from '../../../../server/routes/fixtures/settingsForm.js';

// #402: the server merges a save into the stored entry, and the toggle sets
// only `enabled`. These pin what the form sends for stored entries to the
// fixtures that server/routes/integrations.merge.test.js sends to the real
// routes, so the two sides can't drift apart.

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

function stubServer() {
  const writes = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, opts = {}) => {
      const method = opts.method || 'GET';
      const body = method === 'GET' ? undefined : JSON.parse(opts.body);
      if (body) writes.push({ method, url, body });
      if (url === '/api/integrations/presets') return Response.json(PRESETS);
      if (url === '/api/services/config') {
        return Response.json({
          integrations: {
            [STATUSPAGE.key]: STATUSPAGE.entry,
            [ADGUARD_PRIMARY.key]: ADGUARD_PRIMARY.entry,
            [ZEROS.key]: ZEROS.entry,
          },
        });
      }
      if (url === '/api/services') {
        return Response.json({
          nodes: {
            pi1: { display_name: 'pi1', services: [{ uid: 'pi1:adguard', container: 'adguard' }] },
          },
        });
      }
      if (url === '/api/integrations/save') {
        return Response.json({ ok: true, type: body.editingKey ?? body.type });
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
          },
        },
      ])
    );
  });
});
