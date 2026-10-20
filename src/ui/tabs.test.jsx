import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Tabs, TabList, Tab, TabPanel } from '@ui/tabs';

const NO_RING = /(^|\s|:)outline-(none|hidden|0)(\s|$)/;

function Drawer(props) {
  return (
    <Tabs defaultValue="overview" {...props}>
      <TabList aria-label="Service">
        <Tab value="overview">Overview</Tab>
        <Tab value="containers">Containers</Tab>
        <Tab value="logs" disabled>
          Logs
        </Tab>
        <Tab value="history">History</Tab>
      </TabList>
      <TabPanel value="overview">Uptime and checks</TabPanel>
      <TabPanel value="containers">Three containers</TabPanel>
      <TabPanel value="logs">Log lines</TabPanel>
      <TabPanel value="history">Past incidents</TabPanel>
    </Tabs>
  );
}

describe('Tabs', () => {
  it('renders a named tablist, its tabs and the active panel, wired by ARIA', () => {
    render(<Drawer />);
    const list = screen.getByRole('tablist', { name: 'Service' });
    expect(list).toHaveClass('border-b', 'border-border');
    const tab = screen.getByRole('tab', { name: 'Overview' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Containers' })).toHaveAttribute(
      'aria-selected',
      'false'
    );
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveTextContent('Uptime and checks');
    expect(panel).toHaveAttribute('aria-labelledby', tab.id);
    expect(tab).toHaveAttribute('aria-controls', panel.id);
    // The active tab: an accent-text label over a 2px accent bar (§5.2).
    expect(tab).toHaveClass(
      'h-control',
      'text-body-sm',
      'font-semibold',
      'text-text-2',
      'data-active:text-accent-text',
      'data-active:after:bg-accent',
      'after:h-0.5'
    );
    expect(tab.className).not.toMatch(NO_RING);
  });

  it('moves between tabs with the arrow keys, Home and End, and shows each one’s panel', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Drawer onValueChange={onValueChange} />);
    await user.tab();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    const containers = screen.getByRole('tab', { name: 'Containers' });
    expect(containers).toHaveFocus();
    expect(containers).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Three containers');
    expect(onValueChange).toHaveBeenLastCalledWith('containers', expect.anything());
    // A disabled tab can be reached, so it can be found, but never shows its panel.
    await user.keyboard('{ArrowRight}');
    const logs = screen.getByRole('tab', { name: 'Logs' });
    expect(logs).toHaveFocus();
    expect(logs).toHaveAttribute('aria-disabled', 'true');
    expect(logs).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Three containers');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'History' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'History' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Past incidents');
  });

  it('takes Tab from the tab list to the panel, and back with Shift+Tab', async () => {
    const user = userEvent.setup();
    render(<Drawer />);
    await user.tab();
    await user.tab();
    expect(screen.getByRole('tabpanel')).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveFocus();
  });

  it('activates a tab on click', async () => {
    const user = userEvent.setup();
    render(<Drawer />);
    await user.click(screen.getByRole('tab', { name: 'History' }));
    expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Past incidents');
  });

  it('can wait for Enter or Space before showing a panel', async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="a">
        <TabList aria-label="Manual" activateOnFocus={false}>
          <Tab value="a">A</Tab>
          <Tab value="b">B</Tab>
        </TabList>
        <TabPanel value="a">Panel A</TabPanel>
        <TabPanel value="b">Panel B</TabPanel>
      </Tabs>
    );
    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'B' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel A');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel B');
  });
});
