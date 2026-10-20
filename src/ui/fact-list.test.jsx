import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { FactList } from '@ui/fact-list';

// The mock's UPS facts, in its detail drawer.
const UPS = [
  { key: 'charge', label: 'Charge', value: '82 %' },
  { key: 'runtime', label: 'Runtime', value: '~31 min' },
  { key: 'load', label: 'Load', value: '34 %' },
  { key: 'input', label: 'Input', value: '0 V' },
];

const list = () => document.querySelector('[data-slot="fact-list"]');

describe('FactList', () => {
  it('is a description list: each label a term, each value its definition, in order', () => {
    render(<FactList facts={UPS} />);
    expect(list().tagName).toBe('DL');
    expect(screen.getAllByRole('term').map((t) => t.textContent)).toEqual([
      'Charge',
      'Runtime',
      'Load',
      'Input',
    ]);
    expect(screen.getAllByRole('definition').map((d) => d.textContent)).toEqual([
      '82 %',
      '~31 min',
      '34 %',
      '0 V',
    ]);
    // Term then definition, as siblings of the grid, so each pair is one row.
    expect([...list().children].map((el) => el.tagName)).toEqual([
      'DT',
      'DD',
      'DT',
      'DD',
      'DT',
      'DD',
      'DT',
      'DD',
    ]);
  });

  it("draws the drawer's list: a label column and a value column, 10px by 12px apart", () => {
    render(<FactList facts={UPS} />);
    expect(list()).toHaveClass('grid', 'gap-x-3', 'gap-y-2.5');
    const label = screen.getByText('Charge');
    expect(label).toHaveClass('text-text-3');
    const value = screen.getByText('82 %');
    expect(value).toHaveClass('font-semibold', 'text-text-1', 'min-w-0');
  });

  it("is the Phone board's below 384px of its container (120px, 14px) and the drawer's from there (130px, 13px)", () => {
    render(<FactList facts={UPS} />);
    expect(list().parentElement).toHaveClass('@container');
    expect(list()).toHaveClass(
      'grid-cols-[120px_minmax(0,1fr)]',
      'text-body',
      '@sm:grid-cols-[130px_minmax(0,1fr)]',
      '@sm:text-body-sm',
      '@sm:leading-5'
    );
  });

  it('breaks a value with no break in it (a URL, a SHA, a hostname) inside its column', () => {
    // jsdom can't lay it out: the gallery's fact-list-long state shows it at
    // the drawer's and the phone's widths (#289). Without this, a long URL ran
    // past its column and out of a drawer.
    const url = 'https://photos.jagbhandal.com/api/server/ping?verbose=true&format=json';
    const sha = '3f9c2e1a7b6d4c08e5f2a91b3c7d6e4f5a8b9c0d';
    render(
      <FactList
        facts={[
          { key: 'url', label: 'Address', value: url },
          { key: 'sha', label: 'Image', value: <code>{sha}</code> },
        ]}
      />
    );
    for (const value of screen.getAllByRole('definition')) {
      expect(value).toHaveClass('min-w-0', 'wrap-anywhere');
    }
    // The value column may shrink below its longest word: minmax(0, 1fr).
    expect(list().className).toMatch(/grid-cols-\[120px_minmax\(0,1fr\)\]/);
  });

  it('renders nothing without facts', () => {
    const { container } = render(<FactList facts={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('takes any node as a value, a host in mono for one', () => {
    render(
      <FactList
        facts={[{ key: 'host', label: 'Host', value: <span className="font-mono">vm-103</span> }]}
      />
    );
    expect(within(screen.getByRole('definition')).getByText('vm-103')).toHaveClass('font-mono');
  });

  it('passes className and other props to its outer element', () => {
    render(<FactList facts={UPS} className="mt-4" data-testid="ups" />);
    expect(screen.getByTestId('ups')).toHaveClass('mt-4', '@container');
  });
});
