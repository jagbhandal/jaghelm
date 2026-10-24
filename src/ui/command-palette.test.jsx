import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { CommandPalette, rowName } from '@ui/command-palette';
import { UiRoot } from '@ui/root';

// The palette's look and keys (#315): src/components/CommandPalette.test.jsx
// and src/App.palette.test.jsx check what it finds and where each row goes.

function groupsWith(handlers = {}) {
  return [
    {
      id: 'issues',
      heading: 'Issues',
      rows: [
        {
          id: 'issue:services/apps:immich',
          label: 'Immich',
          kind: 'Issue',
          where: 'Service · apps',
          detail: 'Kuma: HTTP 502',
          state: 'crit',
          word: 'Down',
          href: '/?entity=services/apps:immich',
          onOpen: handlers.immich ?? vi.fn(),
        },
      ],
    },
    {
      id: 'entities:nodes',
      heading: 'Nodes',
      rows: [
        {
          id: 'entity:nodes/pve',
          label: 'Proxmox',
          kind: 'Node',
          where: 'pve',
          detail: 'Healthy',
          state: 'ok',
          word: 'Healthy',
          href: '/?entity=nodes/pve',
          onOpen: handlers.pve ?? vi.fn(),
        },
      ],
    },
    {
      id: 'links',
      heading: 'Quick Launch',
      rows: [
        {
          id: 'link:personal:0',
          label: 'Open Nextcloud',
          kind: 'Link',
          where: 'Personal',
          detail: 'cloud.example',
          href: 'https://cloud.example/',
          target: '_blank',
        },
      ],
    },
    {
      id: 'actions',
      heading: 'Actions',
      rows: [
        {
          id: 'action:logout',
          label: 'Log out',
          kind: 'Action',
          onOpen: handlers.logout ?? vi.fn(),
        },
      ],
    },
  ];
}

function Harness({ groups, onClose, onQueryChange }) {
  const [query, setQuery] = useState('');
  return (
    <>
      <button type="button">Opener</button>
      <CommandPalette
        open
        onClose={onClose}
        query={query}
        onQueryChange={(q) => {
          setQuery(q);
          onQueryChange?.(q);
        }}
        groups={groups}
      />
    </>
  );
}

function renderPalette(handlers = {}, groups = groupsWith(handlers)) {
  const onClose = vi.fn();
  const onQueryChange = vi.fn();
  const utils = render(<Harness groups={groups} onClose={onClose} onQueryChange={onQueryChange} />);
  return { ...utils, onClose, onQueryChange };
}

const combo = () => screen.getByRole('combobox', { name: 'Search' });
const option = (name) => screen.getByRole('option', { name: new RegExp(`^${name}`) });

describe('CommandPalette', () => {
  it('draws nothing while closed', () => {
    const { container } = render(<CommandPalette open={false} onClose={() => {}} groups={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is a dialog with a search field over a listbox of groups, each named by its heading', () => {
    renderPalette();
    const dialog = screen.getByRole('dialog', { name: 'Search or jump to' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const list = screen.getByRole('listbox', { name: 'Results' });
    expect(combo()).toHaveAttribute('aria-controls', list.id);
    expect(combo()).toHaveAttribute('aria-expanded', 'true');
    const groups = within(list).getAllByRole('group');
    expect(
      groups
        .map((g) => g.getAttribute('aria-labelledby'))
        .map((id) => document.getElementById(id).textContent)
    ).toEqual(['Issues', 'Nodes', 'Quick Launch', 'Actions']);
    expect(within(groups[1]).getByRole('option', { name: /^Proxmox/ })).toBeInTheDocument();
  });

  it('names each row by its name, kind, state word, where and detail; its lamp is decorative', () => {
    renderPalette();
    expect(option('Immich')).toHaveAccessibleName(
      'Immich, Issue, Down, Service · apps, Kuma: HTTP 502'
    );
    // An entity's detail is its word: said once.
    expect(option('Proxmox')).toHaveAccessibleName('Proxmox, Node, Healthy, pve');
    expect(option('Open Nextcloud')).toHaveAccessibleName(
      'Open Nextcloud, Link, Personal, cloud.example'
    );
    expect(option('Log out')).toHaveAccessibleName('Log out, Action');
    const lamp = option('Immich').querySelector('[data-slot="status-lamp"]');
    expect(lamp).toHaveAttribute('aria-hidden', 'true');
    expect(lamp).toHaveAttribute('data-state', 'crit');
    expect(option('Open Nextcloud').querySelector('[data-slot="status-lamp"]')).toBeNull();
    // What shows: the name, "where · detail", the kind.
    expect(option('Immich')).toHaveTextContent('ImmichService · apps · Kuma: HTTP 502Issue');
    expect(rowName({ label: 'X', kind: 'Node', state: 'unknown', word: 'Healthy' })).toBe(
      'X, Node, No signal'
    );
  });

  it('focuses the field; the arrows move the highlighted row across groups', async () => {
    const user = userEvent.setup();
    renderPalette();
    await vi.waitFor(() => expect(combo()).toHaveFocus());
    const options = screen.getAllByRole('option');
    expect(combo()).toHaveAttribute('aria-activedescendant', options[0].id);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(combo()).toHaveAttribute('aria-activedescendant', options[2].id);
    expect(options[2]).toHaveAttribute('aria-selected', 'true');
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(combo()).toHaveAttribute('aria-activedescendant', options[3].id);
    await user.keyboard('{ArrowUp}');
    expect(combo()).toHaveAttribute('aria-activedescendant', options[2].id);
    // Tab stays in the field.
    await user.keyboard('{Tab}');
    expect(combo()).toHaveFocus();
  });

  it('Enter opens the highlighted row: closes, gives focus back, then opens it', async () => {
    const user = userEvent.setup();
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    try {
      // Focus is back where it was when the row opens (an entity's drawer returns it there).
      const pve = vi.fn(() => expect(opener).toHaveFocus());
      const { onClose } = renderPalette({ pve });
      await vi.waitFor(() => expect(combo()).toHaveFocus());
      await user.keyboard('{ArrowDown}{Enter}');
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(pve).toHaveBeenCalledTimes(1);
    } finally {
      opener.remove();
    }
  });

  it('a plain click opens an entity row in the page; Ctrl, ⌘ or the middle button leave it to the browser', () => {
    const immich = vi.fn();
    const { onClose } = renderPalette({ immich });
    const row = option('Immich');
    expect(row.tagName).toBe('A');
    expect(row).toHaveAttribute('href', '/?entity=services/apps:immich');
    expect(row).not.toHaveAttribute('target');
    expect(row).toHaveAttribute('tabindex', '-1');

    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
      fireEvent(row, event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(immich).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    const plain = new MouseEvent('click', { bubbles: true, cancelable: true });
    fireEvent(row, plain);
    expect(plain.defaultPrevented).toBe(true);
    expect(immich).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a Quick Launch row is the plain link: its target, no opener; a click follows it, Enter clicks it', async () => {
    const user = userEvent.setup();
    const { onClose } = renderPalette();
    const link = option('Open Nextcloud');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', 'https://cloud.example/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');

    // The clicks on the link, after the palette's handler: whether the
    // browser would still follow each (jsdom can't, so they stop here).
    const followed = [];
    const onClick = (e) => {
      if (e.target !== link) return;
      followed.push(!e.defaultPrevented);
      e.preventDefault();
    };
    document.addEventListener('click', onClick);
    try {
      await vi.waitFor(() => expect(combo()).toHaveFocus());
      await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
      expect(followed).toEqual([true]);
      expect(onClose).toHaveBeenCalledTimes(1);

      // A Ctrl-click is the browser's alone: the palette stays.
      fireEvent.click(link, { ctrlKey: true });
      expect(followed).toEqual([true, true]);
      expect(onClose).toHaveBeenCalledTimes(1);
      // A plain one follows it and closes the palette.
      fireEvent.click(link);
      expect(followed).toEqual([true, true, true]);
      expect(onClose).toHaveBeenCalledTimes(2);
    } finally {
      document.removeEventListener('click', onClick);
    }
  });

  it('a command row runs on a click', async () => {
    const user = userEvent.setup();
    const logout = vi.fn();
    const { onClose } = renderPalette({ logout });
    const row = option('Log out');
    expect(row.tagName).toBe('DIV');
    await user.click(row);
    expect(logout).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape, the Esc button and the scrim close it, and focus goes back', async () => {
    const user = userEvent.setup();
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    try {
      const { onClose, unmount } = renderPalette();
      await vi.waitFor(() => expect(combo()).toHaveFocus());
      await user.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(opener).toHaveFocus();
      fireEvent.click(screen.getByRole('button', { name: 'Esc to close' }));
      expect(onClose).toHaveBeenCalledTimes(2);
      fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
      expect(onClose).toHaveBeenCalledTimes(3);
      // Gone without closing itself (⌘K again): focus still goes back.
      combo().focus();
      unmount();
      expect(opener).toHaveFocus();
    } finally {
      opener.remove();
    }
  });

  it('typing reports the query and starts again from the first row', async () => {
    const user = userEvent.setup();
    const { onQueryChange } = renderPalette();
    await user.click(combo());
    await user.keyboard('{ArrowDown}');
    await user.type(combo(), 'p');
    expect(onQueryChange).toHaveBeenLastCalledWith('p');
    expect(combo()).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[0].id);
  });

  it('holds the highlighted row by its id: rows that move keep it and Enter opens it; one that goes leaves the first', async () => {
    const user = userEvent.setup();
    const opened = vi.fn();
    const onClose = vi.fn();
    const row = (name) => ({
      id: `entity:${name}`,
      label: name,
      kind: 'Service',
      href: `/?entity=${name}`,
      onOpen: () => opened(name),
    });
    const draw = (names) => (
      <CommandPalette
        open
        onClose={onClose}
        query=""
        groups={[{ id: 'services', heading: 'Services', rows: names.map(row) }]}
      />
    );
    const { rerender } = render(draw(['Alpha', 'Bravo', 'Charlie']));
    await vi.waitFor(() => expect(combo()).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    expect(option('Bravo')).toHaveAttribute('aria-selected', 'true');

    // A status poll moves the rows: Bravo stays highlighted, now last.
    rerender(draw(['Charlie', 'Alpha', 'Bravo']));
    expect(option('Bravo')).toHaveAttribute('aria-selected', 'true');
    expect(combo()).toHaveAttribute('aria-activedescendant', option('Bravo').id);
    expect(screen.getAllByRole('option')[2]).toBe(option('Bravo'));
    await user.keyboard('{ArrowUp}');
    expect(option('Alpha')).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}');
    rerender(draw(['Bravo', 'Charlie', 'Alpha']));
    await user.keyboard('{Enter}');
    expect(opened).toHaveBeenCalledWith('Bravo');
    expect(opened).toHaveBeenCalledTimes(1);

    // Bravo goes: the first row is highlighted.
    rerender(draw(['Charlie', 'Alpha']));
    expect(option('Charlie')).toHaveAttribute('aria-selected', 'true');
    expect(combo()).toHaveAttribute('aria-activedescendant', option('Charlie').id);
  });

  it('is portalled to the end of the page, a root with the screen’s switches', () => {
    render(
      <UiRoot theme="light">
        <div data-testid="screen">
          <CommandPalette open onClose={() => {}} query="" groups={groupsWith()} />
        </div>
      </UiRoot>
    );
    const root = screen.getByRole('dialog').closest('[data-slot="command-palette-root"]');
    expect(root.parentElement).toBe(document.body);
    expect(root).toHaveClass('jh-ui');
    expect(root).toHaveAttribute('data-theme', 'light');
    expect(screen.getByTestId('screen')).toBeEmptyDOMElement();
  });

  it('Escape stops at the palette: a listener under it never hears it', async () => {
    const user = userEvent.setup();
    const heard = vi.fn();
    document.addEventListener('keydown', heard);
    try {
      const { onClose } = renderPalette();
      await vi.waitFor(() => expect(combo()).toHaveFocus());
      await user.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(heard).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', heard);
    }
  });

  it('the field fills its row, with no box of its own: its ring traces the row', () => {
    renderPalette();
    const classes = combo().className.split(/\s+/);
    expect(classes).toEqual(
      expect.arrayContaining(['size-full', 'bg-transparent', 'text-title-xs', '-outline-offset-2'])
    );
    expect(classes.some((c) => /^border/.test(c))).toBe(false);
    expect(combo().parentElement).toHaveClass('h-13');
  });

  it('with nothing to show, says the query matched nothing', () => {
    render(<CommandPalette open onClose={() => {}} query="zzz" groups={[]} />);
    expect(screen.getByRole('status')).toHaveTextContent('Nothing matches “zzz”.');
    expect(screen.getByRole('combobox')).not.toHaveAttribute('aria-activedescendant');
  });

  it('while the rows are on their way, says so, never that nothing matched (#611)', () => {
    const { rerender } = render(
      <CommandPalette open onClose={() => {}} query="zzz" groups={[]} loading />
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(screen.queryByText(/Nothing/)).toBeNull();
    rerender(<CommandPalette open onClose={() => {}} groups={[]} error="Couldn’t load." />);
    expect(screen.getByRole('status')).toHaveTextContent('Couldn’t load.');
  });
});
