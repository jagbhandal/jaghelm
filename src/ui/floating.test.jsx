// The floating layer (src/ui/lib/floating.jsx, #444): each floating component
// used cold, before its Base UI part has loaded, from the keyboard. Every
// other test file has the layer loaded before it runs (src/testing/setup.js);
// here each test gets a layer of its own that loads only when the test lets
// it in (`arrive()`), so the first input lands on the light trigger, as it
// can in the app when the chunk is slow to come.
import { render, screen, waitFor, act, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RefreshCw } from 'lucide-react';
import { Button } from '@ui/button';
import { IconButton } from '@ui/icon-button';
import { Tooltip } from '@ui/tooltip';
import { Popover } from '@ui/popover';
import { Dialog } from '@ui/dialog';
import { Drawer } from '@ui/drawer';
import { Confirm } from '@ui/confirm';
import { Select } from '@ui/select';
import { Field } from '@ui/field';
import { Sparkline } from '@ui/sparkline';

const cold = vi.hoisted(() => ({ layer: null, arrive: null, imports: 0 }));

vi.mock('@ui/lib/floating.jsx', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    useFloatingLayer: (now) => real.useFloatingLayer(now, cold.layer),
    useFloatingTrigger: (options) => real.useFloatingTrigger({ ...options, from: cold.layer }),
  };
});

let createFloatingLayer;
beforeEach(async () => {
  ({ createFloatingLayer } = await vi.importActual('@ui/lib/floating.jsx'));
  let arrive;
  const gate = new Promise((resolve) => {
    arrive = resolve;
  });
  cold.imports = 0;
  cold.arrive = async () => {
    arrive();
    await act(() => cold.layer.load());
  };
  cold.layer = createFloatingLayer(async () => {
    cold.imports += 1;
    await gate;
    return import('@ui/floating/layer.js');
  });
});

const popup = (slot) => document.querySelector(`[data-slot="${slot}"]`);

describe('the floating layer', () => {
  it('stays out until the first input, then loads once for every component', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Tooltip content="Reload">
          <IconButton label="Reload">
            <RefreshCw />
          </IconButton>
        </Tooltip>
        <Popover trigger={<Button>Group</Button>} title="Group by">
          Node
        </Popover>
        <Dialog trigger={<Button>Add</Button>} title="Add an app" />
      </>
    );
    expect(cold.imports).toBe(0);
    await user.pointer({ coords: { x: 1, y: 1 } });
    await user.keyboard('{Shift}');
    expect(cold.imports).toBe(1);
    await cold.arrive();
    expect(cold.layer.get()).not.toBeNull();
    expect(cold.imports).toBe(1);
  });

  it('loads at once for a popup opened from code, and a Select', () => {
    render(<Dialog open title="Opened from code" onOpenChange={() => {}} />);
    expect(cold.imports).toBe(1);
  });

  it('asks again on the next use after a failed load', async () => {
    const noisy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      let fail = true;
      cold.layer = createFloatingLayer(async () => {
        cold.imports += 1;
        if (fail) throw new Error('offline');
        return import('@ui/floating/layer.js');
      });
      const user = userEvent.setup();
      render(
        <Tooltip content="Reload">
          <IconButton label="Reload">
            <RefreshCw />
          </IconButton>
        </Tooltip>
      );
      await user.keyboard('{Shift}');
      await waitFor(() => expect(noisy).toHaveBeenCalled());
      expect(cold.layer.get()).toBeNull();
      fail = false;
      await act(() => cold.layer.load());
      expect(cold.layer.get()).not.toBeNull();
      expect(cold.imports).toBe(2);
    } finally {
      noisy.mockRestore();
    }
  });

  it('drops an open asked for while the layer failed, rather than opening it later', async () => {
    const noisy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      let fail = true;
      cold.layer = createFloatingLayer(async () => {
        if (fail) throw new Error('offline');
        return import('@ui/floating/layer.js');
      });
      const user = userEvent.setup();
      render(
        <Popover trigger={<Button>Group</Button>} title="Group by">
          Node
        </Popover>
      );
      await user.click(screen.getByRole('button', { name: 'Group' }));
      await waitFor(() => expect(noisy).toHaveBeenCalled());
      fail = false;
      await act(() => cold.layer.load());
      expect(screen.getByRole('button', { name: 'Group' })).toHaveAttribute(
        'aria-expanded',
        'false'
      );
      expect(popup('popover')).toBeNull();
    } finally {
      noisy.mockRestore();
    }
  });

  it('hands a pressed trigger over after its click, which lands once', async () => {
    const onClick = vi.fn();
    render(
      <Tooltip content="Reload">
        <IconButton label="Reload" onClick={onClick}>
          <RefreshCw />
        </IconButton>
      </Tooltip>
    );
    const light = screen.getByRole('button', { name: 'Reload' });
    fireEvent.pointerDown(light, { button: 0 });
    await cold.arrive();
    // Still the light trigger: the press isn't over.
    expect(screen.getByRole('button', { name: 'Reload' })).toBe(light);
    fireEvent.pointerUp(light);
    fireEvent.click(light);
    expect(onClick).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reload' })).not.toBe(light));
  });
});

describe('each floating component, used cold from the keyboard', () => {
  it('Tooltip: focus taken before the layer opens it once in, focus kept, described all along', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Still loaded: opens where you left it">
        <Button>Immich</Button>
      </Tooltip>
    );
    const light = screen.getByRole('button', { name: 'Immich' });
    expect(light).toHaveAccessibleDescription('Still loaded: opens where you left it');
    await user.tab();
    expect(light).toHaveFocus();
    expect(popup('tooltip')).toBeNull();
    await cold.arrive();
    await waitFor(() => expect(popup('tooltip')).toHaveTextContent('Still loaded'));
    const trigger = screen.getByRole('button', { name: 'Immich' });
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAccessibleDescription('Still loaded: opens where you left it');
    expect(popup('tooltip')).toHaveAttribute('aria-hidden', 'true');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(popup('tooltip')).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it('Popover: Enter before the layer opens it once in, focus inside, the trigger expanded', async () => {
    const user = userEvent.setup();
    render(
      <Popover trigger={<Button>Group</Button>} title="Group by">
        Node
      </Popover>
    );
    const light = screen.getByRole('button', { name: 'Group' });
    expect(light).toHaveAttribute('aria-haspopup', 'dialog');
    expect(light).toHaveAttribute('aria-expanded', 'false');
    await user.tab();
    await user.keyboard('{Enter}');
    expect(popup('popover')).toBeNull();
    await cold.arrive();
    const dialog = await screen.findByRole('dialog', { name: 'Group by' });
    const trigger = screen.getByRole('button', { name: 'Group' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(dialog).toContainElement(document.activeElement));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(popup('popover')).toBeNull());
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('Dialog: Enter before the layer opens it once in, focus inside, and back on Escape', async () => {
    const user = userEvent.setup();
    render(<Dialog trigger={<Button>Add</Button>} title="Add an app" description="Its URL" />);
    const light = screen.getByRole('button', { name: 'Add' });
    expect(light).toHaveAttribute('aria-haspopup', 'dialog');
    expect(light).toHaveAttribute('aria-expanded', 'false');
    await user.tab();
    await user.keyboard('{Enter}');
    await cold.arrive();
    const dialog = await screen.findByRole('dialog', { name: 'Add an app' });
    expect(dialog).toHaveAccessibleDescription('Its URL');
    await waitFor(() => expect(dialog).toContainElement(document.activeElement));
    const trigger = screen.getByRole('button', { name: 'Add', hidden: true });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(popup('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Add' })).toHaveFocus();
  });

  it('Drawer: Space before the layer opens it once in, focus inside, the trigger expanded', async () => {
    const user = userEvent.setup();
    render(
      <Drawer trigger={<Button>Details</Button>} eyebrow="Service" title="Grafana">
        Up for 3 days
      </Drawer>
    );
    await user.tab();
    await user.keyboard(' ');
    await cold.arrive();
    const drawer = await screen.findByRole('dialog', { name: 'Grafana' });
    await waitFor(() => expect(drawer).toContainElement(document.activeElement));
    expect(screen.getByRole('button', { name: 'Details', hidden: true })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await user.keyboard('{Escape}');
    await waitFor(() => expect(popup('drawer')).toBeNull());
    expect(screen.getByRole('button', { name: 'Details' })).toHaveFocus();
  });

  it('Confirm: Enter before the layer opens it once in, focus on Cancel when destructive', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <Confirm
        trigger={<Button>Remove</Button>}
        title="Remove this device?"
        name="Pixel 8"
        destructive
        confirmLabel="Remove"
        onCancel={onCancel}
      />
    );
    await user.tab();
    await user.keyboard('{Enter}');
    await cold.arrive();
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove this device?' });
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    );
    await user.keyboard('{Escape}');
    await waitFor(() => expect(popup('confirm')).toBeNull());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Remove' })).toHaveFocus();
  });

  it("Select: named by its Field, an arrow before the layer opens the list once in, the chosen one active", async () => {
    const user = userEvent.setup();
    const items = [
      { value: 'manrope', label: 'Manrope' },
      { value: 'montserrat', label: 'Montserrat' },
    ];
    render(
      <Field label="Typeface" description="For the new screens">
        <Select items={items} defaultValue="montserrat" />
      </Field>
    );
    // A Select loads the layer as it mounts: its trigger is the control.
    expect(cold.imports).toBe(1);
    const light = screen.getByRole('combobox', { name: 'Typeface' });
    expect(light).toHaveAccessibleDescription('For the new screens');
    expect(light).toHaveTextContent('Montserrat');
    expect(light).toHaveAttribute('aria-haspopup', 'listbox');
    expect(light).toHaveAttribute('aria-expanded', 'false');
    await user.tab();
    expect(light).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    await cold.arrive();
    await screen.findByRole('listbox');
    const trigger = screen.getByRole('combobox', { name: 'Typeface' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const chosen = screen.getByRole('option', { name: 'Montserrat' });
    expect(chosen).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(chosen).toHaveFocus());
    await user.keyboard('{ArrowUp}{Enter}');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(trigger).toHaveTextContent('Manrope');
    expect(trigger).toHaveFocus();
  });

  it("Select: its light trigger draws as Base UI's, so nothing moves when the layer comes", async () => {
    const items = [
      { value: 'pi-1', label: 'pi-1' },
      { value: 'vm-103', label: 'vm-103' },
    ];
    /** The trigger as a person and a screen reader meet it. */
    const drawn = (el) => ({
      role: el.getAttribute('role'),
      tag: el.tagName,
      type: el.getAttribute('type'),
      className: el.className,
      text: el.textContent,
      placeholder: el.getAttribute('data-placeholder'),
      disabled: el.hasAttribute('disabled'),
      dataDisabled: el.getAttribute('data-disabled'),
      invalid: el.getAttribute('aria-invalid'),
      haspopup: el.getAttribute('aria-haspopup'),
      expanded: el.getAttribute('aria-expanded'),
      slot: el.getAttribute('data-slot'),
      parts: [...el.children].map((c) => [c.tagName, c.className, c.getAttribute('aria-hidden')]),
      icon: el.querySelector('svg')?.outerHTML,
    });
    const cases = [
      <Field key="a" label="Node" description="Where it runs">
        <Select items={items} defaultValue="vm-103" />
      </Field>,
      <Select key="b" aria-label="Node" items={items} placeholder="Choose a node" />,
      <Select key="c" aria-label="Node" items={items} defaultValue="pi-1" disabled />,
    ];
    for (const ui of cases) {
      const { unmount } = render(ui);
      const light = screen.getByRole('combobox', { name: 'Node' });
      const before = { ...drawn(light), description: light.getAttribute('aria-describedby') && 'yes' };
      const description = ui.props.description;
      if (description) expect(light).toHaveAccessibleDescription(description);
      await cold.arrive();
      const real = screen.getByRole('combobox', { name: 'Node' });
      expect(real).not.toBe(light);
      expect({ ...drawn(real), description: real.getAttribute('aria-describedby') && 'yes' }).toEqual(
        before
      );
      if (description) expect(real).toHaveAccessibleDescription(description);
      unmount();
      // A fresh, cold layer for the next case.
      let arrive;
      const gate = new Promise((resolve) => {
        arrive = resolve;
      });
      cold.layer = createFloatingLayer(async () => {
        await gate;
        return import('@ui/floating/layer.js');
      });
      cold.arrive = async () => {
        arrive();
        await act(() => cold.layer.load());
      };
    }
  });

  it('Sparkline: focus before the layer shows the reading once in', async () => {
    const user = userEvent.setup();
    render(<Sparkline label="CPU" points={[10, 40, 30]} unit="%" />);
    await user.tab();
    expect(screen.getByRole('img', { name: 'CPU' })).toHaveFocus();
    expect(popup('sparkline-tooltip')).toBeNull();
    await cold.arrive();
    await waitFor(() => expect(popup('sparkline-tooltip')).toHaveTextContent('30%'));
  });
});
