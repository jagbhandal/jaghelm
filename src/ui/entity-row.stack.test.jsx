import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { EntityRow } from '@ui/entity-row';
import { ServicesSection } from '@ui/services-section';

// A Compose stack's row (#642): the chip after the name, the row named in words.
const DEGRADED = {
  state: 'crit',
  word: 'Degraded',
  name: 'Immich',
  detail: 'Immich Redis is down',
  meta: '—',
  stack: { count: 4, chip: '+3 · 1 down', bad: true },
};
const HEALTHY = {
  state: 'ok',
  word: 'Up',
  name: 'Nextcloud',
  detail: '1.2 TB used',
  meta: '112 ms',
  stack: { count: 5, chip: '+4', bad: false },
};

describe('EntityRow as a stack', () => {
  it('is named "name, stack of N containers, word: why" and the chip is not a name of its own', () => {
    render(<EntityRow {...DEGRADED} onOpen={() => {}} />);
    expect(
      screen.getByRole('button', {
        name: 'Immich, stack of 4 containers, degraded: Immich Redis is down',
      })
    ).toBeInTheDocument();
  });

  it('an up stack is named without a reason', () => {
    render(<EntityRow {...HEALTHY} onOpen={() => {}} />);
    expect(
      screen.getByRole('button', { name: 'Nextcloud, stack of 5 containers, up' })
    ).toBeInTheDocument();
  });

  it('draws the chip, in the level colour while a container fails, neutral when none does', () => {
    const { container, rerender } = render(<EntityRow {...DEGRADED} onOpen={() => {}} />);
    const chip = container.querySelector('[data-slot="entity-stack"]');
    expect(chip).toHaveTextContent('+3 · 1 down');
    expect(chip.className).toMatch(/text-crit-fg/);
    expect(chip).toHaveAttribute('aria-hidden', 'true');
    rerender(<EntityRow {...HEALTHY} onOpen={() => {}} />);
    const quiet = container.querySelector('[data-slot="entity-stack"]');
    expect(quiet.className).toMatch(/text-text-2/);
    expect(quiet.className).not.toMatch(/crit|warn/);
  });

  it('a warning stack takes the warning colour', () => {
    const { container } = render(
      <EntityRow {...DEGRADED} state="warn" stack={{ count: 3, chip: '+2 · 1 stopped', bad: true }} />
    );
    expect(container.querySelector('[data-slot="entity-stack"]').className).toMatch(/text-warn-fg/);
  });

  it('one tab stop: the row opens, the chip takes none', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<EntityRow {...DEGRADED} onOpen={onOpen} />);
    await user.tab();
    expect(screen.getByRole('button')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledTimes(1);
    await user.tab();
    expect(document.body).toHaveFocus();
  });

  it('with the node beside the name, the chip sits between them', () => {
    const { container } = render(<EntityRow {...DEGRADED} where="vm-103" onOpen={() => {}} />);
    const heading = container.querySelector('[data-slot="entity-heading"]');
    expect([...heading.children].map((c) => c.dataset.slot)).toEqual([
      'entity-name',
      'entity-stack',
      'entity-where',
    ]);
  });

  it('a row with no stack is as it was: no chip, the old name', () => {
    const { container } = render(<EntityRow state="ok" word="Up" name="Gitea" onOpen={() => {}} />);
    expect(container.querySelector('[data-slot="entity-stack"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Gitea, Up' })).toBeInTheDocument();
  });
});

describe('ServicesSection with stacks', () => {
  it('passes each row its stack, and a stack row opens like any other', async () => {
    const onOpen = vi.fn();
    render(
      <ServicesSection
        count="2 monitored"
        groups={[
          {
            key: 'node:a',
            title: 'Production',
            host: 'vm-103',
            count: '1 / 2 up',
            rows: [
              { id: 'services/a:immich', anchor: 'a', name: 'Immich', state: 'crit', word: 'Degraded', detail: 'Immich Redis is down', meta: '—', stack: DEGRADED.stack, onOpen },
              { id: 'services/a:gitea', anchor: 'b', name: 'Gitea', state: 'ok', word: 'Up', meta: '31 ms' },
            ],
          },
        ]}
      />
    );
    await userEvent.click(
      screen.getByRole('button', { name: /^Immich, stack of 4 containers, degraded/ })
    );
    expect(onOpen).toHaveBeenCalled();
    expect(document.querySelectorAll('[data-slot="entity-stack"]')).toHaveLength(1);
  });
});
