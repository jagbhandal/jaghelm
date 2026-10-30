import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { UiRoot } from './root.jsx';
import { DriveList, DriveNode, DriveTable, RaidList, RaidTable } from './drive-tables.jsx';

const drive = (over = {}) => ({
  key: 'drive:nas:sda',
  device: 'sda',
  model: 'ST8000',
  type: 'hdd',
  state: 'ok',
  word: 'Healthy',
  reason: 'Healthy',
  temperature: 41.4,
  ...over,
});
const draw = (ui) => render(<UiRoot>{ui}</UiRoot>);

describe('DriveTable', () => {
  it('is named by its node and says the model\'s lamp word, the drive, its kind and its temperature', () => {
    draw(<DriveTable name="NAS" drives={[drive()]} />);
    const table = screen.getByRole('table', { name: 'Drives on NAS' });
    const row = within(table).getByRole('row', { name: /sda/ });
    expect(within(row).getByText('Healthy')).toBeInTheDocument();
    expect(within(row).getByText('Hard disk')).toBeInTheDocument();
    expect(within(row).getByText('41 °C')).toBeInTheDocument();
    expect(within(row).getByText('ST8000')).toBeInTheDocument();
  });

  it('gives the reason of a drive that is not healthy, in the word colour of its state, and a dash for a healthy one', () => {
    draw(
      <DriveTable
        name="NAS"
        drives={[drive(), drive({ key: 'k2', device: 'sdb', state: 'crit', word: 'Critical', reason: 'drive sdb failed its health check' })]}
      />
    );
    expect(screen.getByText('drive sdb failed its health check')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="status-word"][data-state="crit"]')).not.toBeNull();
  });

  it('a drive with no temperature reading shows a dash, never 0', () => {
    draw(<DriveTable name="NAS" drives={[drive({ temperature: null })]} />);
    expect(screen.queryByText(/°C/)).toBeNull();
  });
});

describe('RaidTable', () => {
  it('shows members active against how many are needed', () => {
    draw(
      <RaidTable
        name="NAS"
        arrays={[{ device: 'md0', active: 2, required: 3, state: 'crit', word: 'Critical', reason: 'degraded: 2 of 3 members active, 1 member missing' }]}
      />
    );
    const table = screen.getByRole('table', { name: 'RAID arrays on NAS' });
    expect(within(table).getByText('2 of 3')).toBeInTheDocument();
    expect(within(table).getByText('Critical')).toBeInTheDocument();
  });

  it('with no expected count shows a dash, not a guess', () => {
    draw(<RaidTable name="NAS" arrays={[{ device: 'md0', active: 3, required: null, state: 'unknown', word: 'No signal', reason: 'The expected number of members is not reported' }]} />);
    expect(screen.queryByText(/\d of \d/)).toBeNull();
  });
});

describe('DriveNode', () => {
  it('is its node\'s heading and what it holds, and not a landmark of its own', () => {
    draw(<DriveNode name="NAS">content</DriveNode>);
    expect(screen.getByRole('heading', { level: 4, name: 'NAS' })).toBeInTheDocument();
    const node = document.querySelector('[data-slot="drive-node"]');
    expect(node.tagName).toBe('DIV');
    expect(node).toHaveTextContent('content');
  });
});

describe('DriveList and RaidList (phone)', () => {
  it('names the list by its node and says lamp, drive, kind and temperature, the reason in full for a drive that is not healthy', () => {
    const reason = 'drive sdb has 3 reallocated sectors (grew in the last 7 days) and then some more words';
    draw(<DriveList name="NAS" drives={[drive(), drive({ key: 'k2', device: 'sdb', state: 'warn', word: 'Warning', reason })]} />);
    const list = screen.getByRole('list', { name: 'Drives on NAS' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText('Healthy')).toBeInTheDocument();
    expect(within(list).getAllByText('Hard disk · 41 °C')).toHaveLength(2);
    expect(within(list).getByText(reason)).toBeInTheDocument();
    expect(document.querySelector('[data-slot="status-word"][data-state="warn"]')).not.toBeNull();
  });

  it('a drive with no temperature reading shows a dash, never 0', () => {
    draw(<DriveList name="NAS" drives={[drive({ temperature: null })]} />);
    expect(screen.getByText('Hard disk · —')).toBeInTheDocument();
  });

  it('RaidList shows members active against how many are needed', () => {
    draw(
      <RaidList
        name="NAS"
        arrays={[{ device: 'md0', active: 2, required: 3, state: 'crit', word: 'Critical', reason: 'degraded: 1 member missing' }]}
      />
    );
    const list = screen.getByRole('list', { name: 'RAID arrays on NAS' });
    expect(within(list).getByText('2 of 3 members')).toBeInTheDocument();
    expect(within(list).getByText('degraded: 1 member missing')).toBeInTheDocument();
  });
});

describe('at the °F unit (#494)', () => {
  it('the table and the phone list draw the °C reading in °F, rounded', () => {
    draw(<DriveTable name="NAS" drives={[drive()]} units="imperial" />);
    expect(screen.getByText('107 °F')).toBeInTheDocument(); // 41.4 °C is 106.52 °F
    draw(<DriveList name="NAS" drives={[drive()]} units="imperial" />);
    expect(screen.getByText('Hard disk · 107 °F')).toBeInTheDocument();
  });
});
