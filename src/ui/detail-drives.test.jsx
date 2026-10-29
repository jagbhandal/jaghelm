import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DetailDrives } from './detail-drives.jsx';
import { driveView, STANDBY_NOTE } from '../shell/detail/driveView.js';
import { hdd, nasWith, nvme } from '../testing/driveFixtures.js';

// The Drives block of a node's detail (#728): rows with a lamp, name, word and
// temperature; a tap or Enter opens the details in place; a link's drive is
// open and marked. Statuses are the real model's.

const view = (drives, opts) => driveView(nasWith(drives, opts).entity);
const block = () => document.querySelector('[data-slot="detail-drives"]');
const rowOf = (device) => document.querySelector(`[data-drive="${device}"]`);

describe('DetailDrives', () => {
  it('is a section named Drives, with the count at its end in the worst state', () => {
    render(
      <DetailDrives view={view([hdd('sda'), hdd('sdb', { smartPassed: false }), hdd('sdc')])} />
    );
    const section = screen.getByRole('region', { name: 'Drives' });
    expect(section).toBe(block());
    const count = within(section).getByText('3 · 1 failing');
    expect(count).toHaveClass('text-crit-fg');
  });

  it('a healthy row is quiet: a named lamp, the name, the temperature, no word', () => {
    render(<DetailDrives view={view([hdd('sda', { temperature: 40 })])} />);
    const row = rowOf('sda');
    expect(within(row).getByRole('button', { name: 'sda, Healthy, 40 °C' })).toBeInTheDocument();
    expect(within(row).getByText('sda')).toHaveClass('font-mono');
    expect(within(row).getByText('40 °C')).toBeInTheDocument();
    expect(within(row).getByText('ST8000VN004 · no bad sectors')).toBeInTheDocument();
    expect(row.querySelector('[data-slot="drive-word"]')).toBeNull();
    expect(row).toHaveAttribute('data-state', 'ok');
  });

  it('a failing row says its word in the state colour beside a decorative lamp, and its reason', () => {
    render(<DetailDrives view={view([hdd('sdb', { smartPassed: false })])} />);
    const row = rowOf('sdb');
    expect(within(row).getByText('Critical')).toHaveClass('text-crit-fg');
    expect(within(row).queryByRole('img')).toBeNull();
    expect(row.querySelector('svg[aria-hidden="true"] line')).not.toBeNull(); // the bar
    expect(within(row).getByText('ST8000VN004 · failed its health check')).toBeInTheDocument();
  });

  it('a warning draws the slash, in the warning colour', () => {
    render(<DetailDrives view={view([hdd('sda', { temperature: 57 })])} />);
    expect(within(rowOf('sda')).getByText('Warning')).toHaveClass('text-warn-fg');
  });

  it('opens a row in place by click and by keyboard, and closes it again', async () => {
    const user = userEvent.setup();
    render(<DetailDrives view={view([hdd('sda'), hdd('sdb')])} />);
    const button = within(rowOf('sda')).getByRole('button', { name: /sda/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    // Nothing to point at while shut: no aria-controls to a missing id.
    expect(button).not.toHaveAttribute('aria-controls');
    expect(rowOf('sda').querySelector('[data-slot="drive-details"]')).toBeNull();
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const details = rowOf('sda').querySelector('[data-slot="drive-details"]');
    expect(details).toHaveAttribute('id', button.getAttribute('aria-controls'));
    expect(within(details).getByText('Power-on').nextSibling).toHaveTextContent('5,763 h');
    // The other row stays shut.
    expect(rowOf('sdb').querySelector('[data-slot="drive-details"]')).toBeNull();
    button.focus();
    await user.keyboard('{Enter}');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard(' ');
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('a failed check shows FAILED in the critical colour in the details', async () => {
    const user = userEvent.setup();
    render(<DetailDrives view={view([hdd('sdb', { smartPassed: false })])} />);
    await user.click(within(rowOf('sdb')).getByRole('button'));
    expect(screen.getByText('Failed')).toHaveClass('text-crit-fg');
  });

  it('a link names a drive: its row is open and marked, the others untouched', () => {
    render(
      <DetailDrives view={view([hdd('sda'), hdd('sdb', { smartPassed: false })])} highlight="sdb" />
    );
    expect(rowOf('sdb')).toHaveAttribute('data-highlighted');
    // One opaque mark, and the lamp's cut-out is that same colour.
    expect(rowOf('sdb').className).toMatch(
      /bg-\[color-mix\(in_srgb,var\(--jh-accent\)_12%,var\(--jh-surface-2\)\)\]/
    );
    expect(rowOf('sdb').className).toMatch(
      /\[--jh-lamp-cut:color-mix\(in_srgb,var\(--jh-accent\)_12%,var\(--jh-surface-2\)\)\]/
    );
    expect(rowOf('sda').className).not.toMatch(/lamp-cut:color-mix/);
    expect(within(rowOf('sdb')).getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    expect(rowOf('sda')).not.toHaveAttribute('data-highlighted');
    expect(within(rowOf('sda')).getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  });

  it('a drive the node does not have marks nothing', () => {
    render(<DetailDrives view={view([hdd('sda')])} highlight="sdz" />);
    expect(document.querySelector('[data-highlighted]')).toBeNull();
  });

  it('shows the standby footnote for a node with a drive that can sleep, never for NVMe alone', () => {
    const { unmount } = render(<DetailDrives view={view([hdd('sda'), nvme('nvme0')])} />);
    expect(screen.getByText(STANDBY_NOTE)).toBeInTheDocument();
    expect(STANDBY_NOTE).toBe('Sleeping drives show their last reading');
    unmount();
    render(<DetailDrives view={view([nvme('nvme0')])} />);
    expect(screen.queryByText(STANDBY_NOTE)).toBeNull();
  });

  it('with a declared interval the one footnote replaces the standby one', () => {
    render(<DetailDrives view={view([hdd('sda')], { readingSeconds: 3600 })} />);
    const note = block().querySelector('[data-slot="detail-drives-cadence"]');
    expect(note).toHaveTextContent(
      'Readings refresh about every hour, on their own schedule, not with this page. A sleeping drive shows its last reading.'
    );
    expect(note).toHaveClass('text-caption', 'text-text-3');
    expect(screen.queryByText(STANDBY_NOTE)).toBeNull();
    expect(block().querySelectorAll('p')).toHaveLength(1);
  });

  it('a drive held with no reading is plain content: no button, the ring, "No signal"', () => {
    render(<DetailDrives view={view([hdd('sda')], { blind: true })} />);
    const row = rowOf('sda');
    expect(within(row).queryByRole('button')).toBeNull();
    expect(within(row).getByText('No signal')).toHaveClass('text-unknown-fg');
    expect(within(row).getByText('No reading')).toBeInTheDocument();
  });

  it('draws nothing without a view or without rows', () => {
    const { container, rerender } = render(<DetailDrives view={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<DetailDrives view={{ rows: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('never carries a serial number into the page', () => {
    render(<DetailDrives view={view([hdd('sda', { serial_number: 'SN-SECRET-123' })])} />);
    expect(document.body.innerHTML).not.toMatch(/SN-SECRET/);
  });
});
