import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CronJobs } from './Widgets.jsx';
import { ConfigProvider } from '../context/ConfigContext.jsx';

const nodes = [
  {
    node: 'vm-103',
    jobs: [
      {
        job: 'vm103-backup',
        overdue: true,
        seconds_since_report: 111600,
        expected_every_seconds: 86400,
        runs: [{ status: 'success', timestamp: '2026-10-15T01:00:00Z' }],
      },
      {
        job: 'healthy',
        overdue: false,
        seconds_since_report: 600,
        runs: [{ status: 'success', timestamp: '2026-10-16T01:00:00Z' }],
      },
    ],
  },
];

const renderPanel = (onRemove) =>
  render(
    <ConfigProvider config={{ sections: {} }} setConfig={vi.fn()}>
      <CronJobs nodes={nodes} onRemove={onRemove} />
    </ConfigProvider>
  );

afterEach(() => vi.restoreAllMocks());

describe('CronJobs', () => {
  it('shows an Overdue badge and the age line for an overdue job only', () => {
    renderPanel(vi.fn());
    expect(screen.getAllByText('Overdue')).toHaveLength(1);
    expect(screen.getByText('Last report 31h ago · expected every 24h')).toBeTruthy();
  });

  it('removes after confirmation', () => {
    const onRemove = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPanel(onRemove);
    fireEvent.click(screen.getAllByText('Remove')[0]);
    expect(window.confirm).toHaveBeenCalledWith(
      'Remove vm103-backup on vm-103 and its history? It reappears if it reports again.'
    );
    expect(onRemove).toHaveBeenCalledWith('vm-103', 'vm103-backup');
  });

  it('does nothing when the confirmation is declined', () => {
    const onRemove = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPanel(onRemove);
    fireEvent.click(screen.getAllByText('Remove')[0]);
    expect(onRemove).not.toHaveBeenCalled();
  });
});
