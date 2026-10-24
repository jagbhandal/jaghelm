import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import ServicesTab from './ServicesTab';
import { stackBoard } from '../../../server/testing/stackBoard.js';

// Settings → Nodes & Services' Compose stacks (#642): the row says which stack
// draws it, its editor has Set lead…, Ungroup and Split out, and each edit
// writes `stacks:` per node and project. The board is the server's own.

function setup({ stacks, redis = 'up', onSave = vi.fn() } = {}) {
  const { services: liveServices } = stackBoard({ redis, stacks });
  const serverConfig = {
    services: {},
    nodes: { vm103: { display_name: 'Production', hide: [] } },
    ...(stacks && { stacks }),
  };
  render(
    <ServicesTab
      serverConfig={serverConfig}
      liveServices={liveServices}
      monitorNames={[]}
      onSave={onSave}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: /Production/ }));
  return onSave;
}
const rowFor = (container) => document.querySelector(`[data-service="vm103:${container}"]`);
const edit = (container) =>
  fireEvent.click(within(rowFor(container)).getByRole('button', { name: /^Edit/ }));

describe('Settings → Nodes & Services, stacks', () => {
  it('a row says which stack draws it; a container in none says nothing', () => {
    setup();
    expect(rowFor('immich-server')).toHaveTextContent('leads the immich stack');
    expect(rowFor('immich-redis')).toHaveTextContent('in the immich stack');
    expect(rowFor('collabora')).not.toHaveTextContent('stack');
    expect(rowFor('gitea')).not.toHaveTextContent('stack');
  });

  it('Set lead… on a folded container makes it the lead, for this node and project', async () => {
    const onSave = setup();
    edit('immich-redis');
    expect(
      screen.getByText(/drawn inside the immich stack on Production, led by Immich Server/)
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('combobox', { name: 'Compose stack' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Immich Postgres' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].stacks).toEqual({ 'vm103:immich': { lead: 'immich-postgres' } });
  });

  it('Ungroup, then Group again', async () => {
    const onSave = setup();
    edit('immich-server');
    await userEvent.click(screen.getByRole('button', { name: 'Ungroup' }));
    expect(onSave.mock.calls[0][0].stacks).toEqual({ 'vm103:immich': { ungroup: true } });
  });

  it('an ungrouped stack offers Group again on every one of its containers', async () => {
    const onSave = setup({ stacks: { 'vm103:immich': { ungroup: true } } });
    edit('immich-redis');
    expect(screen.getByText(/drawn as rows of their own/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Group again' }));
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('stacks');
  });

  it('Split out on a folded container, and Keep in stack once it is', async () => {
    const onSave = setup();
    edit('immich-redis');
    await userEvent.click(
      screen.getByRole('button', { name: 'Split Immich Redis out of the stack' })
    );
    expect(onSave.mock.calls[0][0].stacks).toEqual({ 'vm103:immich': { split: ['immich-redis'] } });
  });

  it('a container split out reads as one and can be kept in again', async () => {
    const onSave = setup({ stacks: { 'vm103:immich': { split: ['immich-redis'] } } });
    expect(rowFor('immich-redis')).not.toHaveTextContent('in the immich stack');
    edit('immich-redis');
    expect(screen.getByText(/split out of the immich stack/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep Immich Redis in the stack' }));
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('stacks');
  });

  it('the lead has no Split out, and a chosen lead can go back to automatic', async () => {
    const onSave = setup({ stacks: { 'vm103:immich': { lead: 'immich-postgres' } } });
    edit('immich-postgres');
    expect(screen.queryByRole('button', { name: /out of the stack/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Automatic lead' }));
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('stacks');
  });
});
