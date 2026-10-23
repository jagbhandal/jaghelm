import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  DetailFacts,
  DetailLinks,
  DetailMeters,
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
