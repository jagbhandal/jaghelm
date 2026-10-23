import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DetailFacts,
  DetailLinks,
  DetailMeters,
  DetailRemove,
  DetailRuns,
  DetailSection,
  DetailSections,
  DetailUnread,
  DetailVms,
} from './entity-detail.jsx';

// The detail's parts (#310): drawn from what the screens build, nothing of their own.

describe('DetailSections', () => {
  const SECTIONS = [
    {
      key: 'vms',
      kind: 'vms',
      title: 'Virtual machines',
      aside: '1 / 2 running',
      vms: [
        { key: '1', name: 'web', status: 'Running', running: true, detail: '2 vCPU' },
        { key: '2', name: 'old', status: 'Stopped', running: false, detail: '' },
      ],
    },
    {
      key: 'pools',
      kind: 'meters',
      title: 'Storage pools',
      meters: [
        {
          key: 'pool:a',
          label: 'a',
          value: 96,
          unit: '%',
          warn: 90,
          crit: 95,
          caption: '1 / 2 GB',
        },
      ],
    },
    {
      key: 'backup',
      kind: 'facts',
      title: 'Last backup',
      facts: [{ key: 'when', label: 'When', value: '3 h ago' }],
      note: 'Its last read failed: HTTP 401',
    },
  ];

  it('draws each section by its kind, named by its heading', () => {
    render(<DetailSections sections={SECTIONS} />);
    const vms = screen.getByRole('region', { name: 'Virtual machines' });
    expect(vms).toHaveTextContent('1 / 2 running');
    expect(within(vms).getAllByRole('listitem')).toHaveLength(2);
    const pools = screen.getByRole('region', { name: 'Storage pools' });
    expect(within(pools).getByRole('meter', { name: 'a' })).toHaveAttribute('data-state', 'crit');
    expect(pools).toHaveTextContent('1 / 2 GB');
    const backup = screen.getByRole('region', { name: 'Last backup' });
    expect(within(backup).getByText('3 h ago')).toBeInTheDocument();
    expect(backup).toHaveTextContent('Its last read failed: HTTP 401');
  });

  it('draws nothing without sections, meters, machines or failed reads', () => {
    const { container } = render(
      <>
        <DetailSections />
        <DetailMeters />
        <DetailVms />
        <DetailUnread />
        <DetailLinks />
      </>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('a section without an aside is its heading and what it holds', () => {
    render(
      <DetailSection title="Container">
        <p>CPU</p>
      </DetailSection>
    );
    expect(screen.getByRole('region', { name: 'Container' })).toHaveTextContent('ContainerCPU');
  });
});

describe('DetailFacts', () => {
  const FACTS = [{ key: 'load', label: 'Load', value: '31 %' }];

  it('the facts as they are, while the status is fresh', () => {
    const { container } = render(<DetailFacts facts={FACTS} />);
    expect(container.querySelector('[data-slot="fact-list"]')).not.toHaveAttribute('data-muted');
    expect(container.querySelector('[data-slot="detail-facts"]')).toBeNull();
  });

  it('greyed as last known, saying how old, while it is stale', () => {
    const { container } = render(<DetailFacts facts={FACTS} lastKnown="Last known 3 min ago" />);
    const list = container.querySelector('[data-slot="fact-list"]');
    expect(list).toHaveAttribute('data-muted');
    expect(list.querySelector('dd')).toHaveClass('text-text-2');
    expect(container.querySelector('[data-slot="detail-facts"]')).toHaveTextContent(
      'Last known 3 min ago'
    );
  });
});

describe('DetailUnread', () => {
  it('says what it couldn’t read and why, in no signal’s tone', () => {
    render(
      <DetailUnread unread={[{ key: 'ups', what: "the UPS's readings", error: 'HTTP 502' }]} />
    );
    const banner = document.querySelector('[data-slot="detail-unread"]');
    expect(banner).toHaveAttribute('data-tone', 'unknown');
    expect(banner).toHaveTextContent("Some details aren't updating");
    expect(banner).toHaveTextContent("JagHelm couldn't read the UPS's readings (HTTP 502)");
  });
});

describe('DetailLinks', () => {
  it('opens a link inside JagHelm in the page on a plain click; a link out opens as the user’s links do', () => {
    const onOpen = vi.fn();
    render(
      <DetailLinks
        primary={{
          key: 'open',
          label: 'Open Immich',
          href: 'https://photos.example.com',
          app: false,
        }}
        links={[{ key: 'grafana', label: 'Grafana', href: '/apps/grafana', app: true }]}
        settings={{
          key: 'settings',
          label: 'Service settings',
          href: '/settings/services',
          app: true,
        }}
        target="_blank"
        onOpen={onOpen}
      />
    );
    const out = screen.getByRole('link', { name: 'Open Immich, opens in a new tab' });
    expect(out).toHaveAttribute('target', '_blank');
    expect(out).toHaveAttribute('rel', 'noopener noreferrer');

    const grafana = screen.getByRole('link', { name: 'Grafana' });
    expect(grafana).not.toHaveAttribute('target');
    fireEvent.click(grafana);
    expect(onOpen).toHaveBeenCalledWith('/apps/grafana');
    // A modified click is the browser's: a new tab at the same address.
    fireEvent.click(grafana, { ctrlKey: true });
    expect(onOpen).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('link', { name: 'Service settings' }));
    expect(onOpen).toHaveBeenLastCalledWith('/settings/services');
  });

  it('a link out in this tab, as Settings → Layout can say, says nothing of a new tab', () => {
    render(
      <DetailLinks
        primary={{
          key: 'grafana',
          label: 'Open in Grafana',
          href: 'https://g.example.com',
          app: false,
        }}
        target="_self"
      />
    );
    const link = screen.getByRole('link', { name: 'Open in Grafana' });
    expect(link).toHaveAttribute('target', '_self');
    expect(link).not.toHaveAttribute('rel');
  });
});

describe('DetailRuns (#578)', () => {
  const RUNS = [
    {
      key: 'a',
      state: 'crit',
      word: 'Failed',
      time: 'Oct 20, 03:00',
      duration: '4 s',
      error: 'locked',
    },
    {
      key: 'b',
      state: 'ok',
      word: 'Succeeded',
      time: 'Oct 19, 03:00',
      duration: '23 min',
      error: null,
    },
  ];

  it('each run: its lamp named by its word, when and how long; a failure says so, its error under it', () => {
    const { container } = render(<DetailRuns runs={RUNS} />);
    const [failed, ok] = container.querySelectorAll('li');
    expect(within(failed).getByRole('img', { name: 'Failed' })).toHaveAttribute(
      'data-state',
      'crit'
    );
    expect(failed).toHaveTextContent('Oct 20, 03:00');
    expect(failed).toHaveTextContent('4 s');
    expect(within(failed).getByText('Failed')).toHaveClass('text-crit-fg');
    expect(within(failed).getByText('locked')).toHaveClass('text-crit-fg');
    expect(within(ok).getByRole('img', { name: 'Succeeded' })).toBeInTheDocument();
    // A run that succeeded says its word only to a screen reader, through its lamp.
    expect(within(ok).queryByText('Succeeded')).toBeNull();
  });

  it('a note above them in its state’s colour; a placeholder while they load; none, or nothing', () => {
    const { container, rerender } = render(
      <DetailRuns runs={RUNS} note="Last report 31 h ago · expected every 24 h" />
    );
    expect(container.querySelector('[data-slot="detail-runs-note"]')).toHaveClass('text-warn-fg');
    rerender(<DetailRuns loading note="Last report 31 h ago" />);
    expect(screen.getByText('The runs are loading')).toBeInTheDocument();
    expect(container.querySelector('li')).toBeNull();
    rerender(<DetailRuns runs={[]} />);
    expect(screen.getByText('No runs on record')).toBeInTheDocument();
    rerender(<DetailRuns runs={[]} empty={null} />);
    expect(screen.queryByText('No runs on record')).toBeNull();
  });

  it('DetailSections draws a `runs` section', () => {
    render(
      <DetailSections
        sections={[
          { key: 'runs', kind: 'runs', title: 'Last runs', runs: RUNS, note: 'Overdue line' },
        ]}
      />
    );
    const region = screen.getByRole('region', { name: 'Last runs' });
    expect(within(region).getAllByRole('listitem')).toHaveLength(2);
    expect(within(region).getAllByText('Overdue line')).toHaveLength(1);
  });
});

describe('DetailRemove (#578)', () => {
  const props = {
    title: 'Remove this job?',
    name: 'npm-sync',
    detail: 'On pi-2',
    description: 'Its last runs go with it.',
  };

  it('asks first: Remove… opens the Confirm naming it, and only its Remove acts', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<DetailRemove {...props} onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: 'Remove…' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove this job?' });
    expect(within(dialog).getByText('npm-sync')).toBeInTheDocument();
    expect(within(dialog).getByText('On pi-2')).toBeInTheDocument();
    // Focus starts on Cancel: Enter alone never removes.
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    );
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onConfirm).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Remove…' }));
    const again = await screen.findByRole('alertdialog', { name: 'Remove this job?' });
    await user.click(within(again).getByRole('button', { name: 'Remove' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('a Remove that failed says why over the button; while sent, the button says so', () => {
    const { rerender } = render(
      <DetailRemove
        {...props}
        error={{ title: "Couldn't remove npm-sync", cause: 'JagHelm answered HTTP 500.' }}
      />
    );
    const banner = document.querySelector('[data-slot="detail-remove-error"]');
    expect(banner).toHaveTextContent("Couldn't remove npm-sync");
    expect(banner).toHaveTextContent('JagHelm answered HTTP 500.');
    rerender(<DetailRemove {...props} busy />);
    expect(screen.getByRole('button', { name: 'Removing…' })).toBeDisabled();
  });
});
