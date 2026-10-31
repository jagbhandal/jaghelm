import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { IntegrationForm, IntegrationList, PresetGallery } from '@ui/integrations';

const ROWS = [
  {
    id: 'adguard_primary',
    name: 'AdGuard Home (primary)',
    kind: 'Preset',
    url: 'http://adguard.lab:3000',
    target: 'adguard',
    state: 'ok',
    word: 'OK',
    enabled: true,
  },
  {
    id: 'withkey',
    name: 'withkey',
    kind: 'Custom',
    url: null,
    urlHidden: true,
    state: 'warn',
    word: 'Failing',
    error: 'withkey: its address refused the connection',
    enabled: true,
  },
  {
    id: 'off',
    name: 'Gotify',
    kind: 'Preset',
    url: 'http://g.lab',
    word: 'Disabled',
    enabled: false,
  },
];

describe('IntegrationList', () => {
  it('a row per integration: name as a heading, the model’s word, and what it says of itself', () => {
    render(<IntegrationList rows={ROWS} />);
    const list = screen.getByRole('region', { name: 'Connected' });
    const first = within(list).getByRole('heading', { level: 3, name: 'AdGuard Home (primary)' });
    const row = first.closest('[data-slot="integration-row"]');
    expect(row).toHaveTextContent('Preset');
    expect(row).toHaveTextContent('http://adguard.lab:3000');
    expect(row).toHaveTextContent('→ adguard');
    expect(row).toHaveTextContent('OK');
    const failing = list.querySelector('[data-integration="withkey"]');
    expect(failing).toHaveTextContent('withkey: its address refused the connection');
  });

  it('an address that carries a credential is never shown', () => {
    render(<IntegrationList rows={ROWS} />);
    const row = document.querySelector('[data-integration="withkey"]');
    expect(row).toHaveTextContent('address not shown: it carries a credential');
  });

  it('every action names its integration', () => {
    render(<IntegrationList rows={ROWS} />);
    for (const name of [
      'Disable AdGuard Home (primary)',
      'Edit AdGuard Home (primary)',
      'Remove AdGuard Home (primary)',
      'Enable Gotify',
    ])
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
  });

  it('Remove asks first with the display name, and hands back the key only when confirmed', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<IntegrationList rows={ROWS} onRemove={onRemove} />);
    await user.click(screen.getByRole('button', { name: 'Remove AdGuard Home (primary)' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('AdGuard Home (primary)');
    expect(dialog.textContent).not.toContain('adguard_primary');
    expect(onRemove).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Remove integration' }));
    expect(onRemove).toHaveBeenCalledWith('adguard_primary');
  });

  it('with none set up it says so and offers the custom builder; unread says why instead', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const { rerender } = render(<IntegrationList rows={[]} onAdd={onAdd} />);
    expect(screen.getByText('No integrations yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Custom integration/ }));
    expect(onAdd).toHaveBeenCalled();
    rerender(
      <IntegrationList rows={[]} unread={{ error: 'services.yaml does not parse (line 4)' }} />
    );
    expect(screen.queryByText('No integrations yet')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('services.yaml does not parse (line 4)');
  });
});

describe('PresetGallery', () => {
  const TILES = [
    { type: 'adguard', name: 'AdGuard Home', description: 'DNS stats', configured: true },
    { type: 'netdata', name: 'Netdata', description: 'Dashboards', configured: false },
  ];

  it('a tile per preset, the set-up one marked, a pick gives its type', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<PresetGallery presets={TILES} total={41} onPick={onPick} />);
    expect(screen.getByText('41 presets, or a custom one from any JSON API.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /AdGuard Home/ })).toHaveTextContent('Set up');
    expect(screen.getByRole('button', { name: /Netdata/ })).not.toHaveTextContent('Set up');
    await user.click(screen.getByRole('button', { name: /Netdata/ }));
    expect(onPick).toHaveBeenCalledWith('netdata');
  });

  it('says so when nothing matches', () => {
    render(<PresetGallery presets={[]} total={41} search="zzz" />);
    expect(screen.getByText('No presets match that search.')).toBeInTheDocument();
  });
});

describe('IntegrationForm', () => {
  const FIELDS = [
    { id: 'url', label: 'Base URL', value: 'http://a.lab', onChange: () => {}, wide: true },
    {
      id: 'password',
      kind: 'secret',
      label: 'Password',
      description: 'Stored encrypted on the server. Leave blank to keep it.',
      value: '',
      onChange: () => {},
    },
  ];

  it('a secret field is a password input, empty, with the keep-it note', () => {
    render(<IntegrationForm title="Edit X" fields={FIELDS} />);
    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveValue('');
    expect(
      screen.getByText('Stored encrypted on the server. Leave blank to keep it.')
    ).toBeInTheDocument();
  });

  it('Test and Save wait for an address, and say what the test found', async () => {
    const user = userEvent.setup();
    const onTest = vi.fn();
    const { rerender } = render(
      <IntegrationForm title="Edit X" fields={FIELDS} canSubmit={false} />
    );
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save integration' })).toBeDisabled();
    rerender(
      <IntegrationForm
        title="Edit X"
        fields={FIELDS}
        onTest={onTest}
        test={{ state: 'failed', sentence: 'HTTP 401' }}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(onTest).toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Test failed: HTTP 401');
  });

  it('Remove is there only when editing, and asks by name', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const { rerender } = render(<IntegrationForm title="New" fields={FIELDS} />);
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    rerender(
      <IntegrationForm
        title="Edit"
        fields={FIELDS}
        remove={{ name: 'Netdata (lab)', value: 'netdata_lab', onRemove }}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Netdata (lab)');
    await user.click(within(dialog).getByRole('button', { name: 'Remove integration' }));
    expect(onRemove).toHaveBeenCalledWith('netdata_lab');
  });
});
