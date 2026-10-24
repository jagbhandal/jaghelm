import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BackupJobList, ServiceMap, matchWords } from '@ui/service-mapping';

const row = (more = {}) => ({
  id: 'vm:loki',
  sub: 'loki',
  name: 'Loki',
  state: 'ok',
  stateWord: 'Up',
  hidden: false,
  overridden: false,
  tag: { kind: 'none' },
  editing: false,
  editor: null,
  ...more,
});
const node = (services, open = true) => ({ key: 'vm', name: 'vm-103', icon: '🖥', count: services.length, open, services });

describe('ServiceMap', () => {
  it('a node is a disclosure that names its count and says whether it is open', async () => {
    const onToggleNode = vi.fn();
    render(<ServiceMap nodes={[node([row()], false)]} onToggleNode={onToggleNode} />);
    const button = screen.getByRole('button', { name: /vm-103/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveTextContent('1 service');
    await userEvent.click(button);
    expect(onToggleNode).toHaveBeenCalledWith('vm');
  });

  it('a row names its lamp and tag; Hide and Edit are named by the service', () => {
    render(<ServiceMap nodes={[node([row({ tag: { kind: 'monitored', monitor: 'Loki' } })])]} />);
    expect(screen.getByRole('img', { name: 'Up' })).toBeInTheDocument();
    expect(screen.getByText('monitored')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide Loki' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Loki' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('says it is reading, or that nothing was found', () => {
    const { rerender } = render(<ServiceMap loading />);
    expect(screen.getByText('Reading services…')).toBeInTheDocument();
    rerender(<ServiceMap nodes={[]} />);
    expect(screen.getByText('No services discovered yet')).toBeInTheDocument();
  });

  it('a monitor-only row has no Hide, and its editor is the Node choice alone (#644)', async () => {
    const onNode = vi.fn();
    const only = row({
      id: 'monitor:cadvisor-pi1',
      name: 'cadvisor-pi1',
      tag: { kind: 'monitor-only' },
      monitorOnly: true,
      editing: true,
      editor: { node: { value: '__auto__', items: [{ value: '__auto__', label: 'Automatic' }, { value: 'pi1', label: 'Pi 1' }], hint: 'Shown on Pi 1.' } },
    });
    const plain = row({ id: 'vm:loki', editing: true, editor: { name: '', namePlaceholder: 'Loki', icon: '', monitor: '__auto__', monitorItems: [{ value: '__auto__', label: 'Auto-match' }], suggestion: null, candidates: [] } });
    render(<ServiceMap nodes={[node([only, plain])]} onNode={onNode} />);
    const [onlyRow, plainRow] = document.querySelectorAll('[data-slot="service-row"]');
    expect(within(onlyRow).getByText('monitor only')).toBeInTheDocument();
    expect(within(onlyRow).queryByRole('button', { name: /^Hide/ })).toBeNull();
    expect(within(onlyRow).getByRole('combobox', { name: 'Node' })).toBeInTheDocument();
    expect(within(onlyRow).getByText('Shown on Pi 1.')).toBeInTheDocument();
    expect(within(onlyRow).queryByLabelText('Display name')).toBeNull();
    expect(within(plainRow).queryByRole('combobox', { name: 'Node' })).toBeNull();
    expect(within(plainRow).getByRole('button', { name: /^Hide/ })).toBeInTheDocument();
    await userEvent.click(within(onlyRow).getByRole('combobox', { name: 'Node' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Pi 1' }));
    expect(onNode).toHaveBeenCalledWith('monitor:cadvisor-pi1', 'pi1');
  });

  it('wording of a match: names, a shared word, none', () => {
    expect(matchWords('exact')).toBe('matched by name');
    expect(matchWords('url')).toBe('matched by name');
    expect(matchWords('contains')).toBe('matched by name');
    expect(matchWords('word')).toBe('matched by a shared word');
    expect(matchWords(null)).toBe('no match');
  });
});

describe('BackupJobList', () => {
  it('a switch per job, named by job and node, calls back with the key', async () => {
    const onToggle = vi.fn();
    render(
      <BackupJobList
        rows={[{ key: 'pve:trim', node: 'pve', job: 'trim', backup: false, reporting: true }]}
        onToggle={onToggle}
      />
    );
    const list = screen.getByRole('region', { name: 'Backup jobs' });
    await userEvent.click(within(list).getByRole('switch', { name: 'trim on pve is a backup' }));
    expect(onToggle).toHaveBeenCalledWith('pve:trim', true);
  });
});
