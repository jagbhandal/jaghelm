import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { DetailStack } from '@ui/stack-panel';

const MEMBERS = [
  { id: 'a:server', name: 'Immich Server', state: 'ok', word: 'Up', reason: 'Kuma: up', lead: true, image: 'ghcr.io/immich/server', where: 'Production' },
  { id: 'a:ml', name: 'Machine Learning', state: 'ok', word: 'Running', reason: null },
  { id: 'a:redis', name: 'Redis', state: 'crit', word: 'Down', reason: 'Kuma: down' },
  { id: 'a:db', name: 'Postgres', state: 'warn', word: 'Missing', reason: 'Missing: no longer running' },
];
const STACK = { name: 'Immich', count: 4, members: MEMBERS };

describe('DetailStack', () => {
  it('lists every container with its lamp named, its state in words and its image', () => {
    render(<DetailStack stack={STACK} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent('Lead');
    expect(items[0]).toHaveTextContent('ghcr.io/immich/server · Production');
    expect(items[1]).toHaveTextContent('Running');
    expect(items[2]).toHaveTextContent('Kuma: down');
    expect(within(items[2]).getByRole('img', { name: 'Down' })).toBeInTheDocument();
    expect(items[3]).toHaveTextContent('Missing: no longer running');
  });

  it('with no edits given it is read-only: Details only', () => {
    render(<DetailStack stack={STACK} onDetails={() => {}} />);
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Details of Immich Server',
      'Details of Machine Learning',
      'Details of Redis',
      'Details of Postgres',
    ]);
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('Set lead… offers the containers that do not lead, and disables while saving', async () => {
    const onSetLead = vi.fn();
    const { rerender } = render(
      <DetailStack stack={STACK} onSetLead={onSetLead} onUngroup={() => {}} onSplit={() => {}} onDetails={() => {}} />
    );
    await userEvent.click(screen.getByRole('combobox', { name: 'Set lead' }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Machine Learning',
      'Redis',
      'Postgres',
    ]);
    await userEvent.click(screen.getByRole('option', { name: 'Redis' }));
    expect(onSetLead).toHaveBeenCalledWith(MEMBERS[2]);
    rerender(
      <DetailStack stack={STACK} busy onSetLead={onSetLead} onUngroup={() => {}} onSplit={() => {}} />
    );
    expect(screen.getByRole('button', { name: 'Ungroup' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Split Redis out of the stack' })).toBeDisabled();
  });

  it('says why a save failed', () => {
    render(<DetailStack stack={STACK} error="Not allowed" onSetLead={() => {}} onUngroup={() => {}} />);
    expect(screen.getByText('Not allowed')).toBeInTheDocument();
  });
});
