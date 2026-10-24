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
