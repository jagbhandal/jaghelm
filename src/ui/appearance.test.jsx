import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import {
  AccentChoice,
  FieldGrid,
  FontChoice,
  ImagePicker,
  RangeField,
  SettingBlock,
  SettingRow,
  SettingRows,
  ThemeChoice,
  ToggleRow,
} from '@ui/appearance';
import { SegmentedControl } from '@ui/segmented-control';
import { UiRoot } from '@ui/root';

const NO_RING = /(^|\s|:)outline-(none|hidden|0)(\s|$)/;
const THEMES = [
  { value: 'dark', label: 'Dark', description: 'Graphite' },
  { value: 'light', label: 'Light', description: 'For bright rooms' },
  { value: 'system', label: 'System', description: 'Follows the device' },
];
const ACCENTS = [
  { value: 'violet', label: 'Violet (default)' },
  { value: 'fuchsia', label: 'Fuchsia' },
  { value: 'cyan', label: 'Cyan' },
];

describe('ThemeChoice', () => {
  it('is a named radio group of cards, each named and described, the chosen one ringed', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <ThemeChoice aria-label="Theme" options={THEMES} value="dark" onValueChange={onValueChange} />
    );
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    expect(group).toHaveAttribute('data-slot', 'theme-choice');
    const [dark, light, system] = within(group).getAllByRole('radio');
    expect(dark).toHaveAccessibleName('Dark');
    expect(system).toHaveAccessibleDescription('Follows the device');
    expect(dark).toHaveAttribute('aria-checked', 'true');
    expect(dark.tagName).toBe('BUTTON');
    // The mock's .opt and .opt-on: an edge, and the accent's inset ring once chosen.
    expect(dark).toHaveClass(
      'rounded-lg',
      'border-border',
      'bg-surface-1',
      'data-checked:inset-ring-[1.5px]',
      'data-checked:inset-ring-accent'
    );
    expect(dark.className).not.toMatch(NO_RING);
    await user.click(light);
    expect(onValueChange.mock.calls.at(-1)[0]).toBe('light');
  });

  it('previews each theme by a root in it: dark, light, and the two halved for system', () => {
    render(<ThemeChoice aria-label="Theme" options={THEMES} value="system" />);
    const [dark, light, system] = screen.getAllByRole('radio');
    const page = (card) => [...card.querySelectorAll('.jh-ui.bg-background')];
    expect(page(dark).map((r) => r.getAttribute('data-theme'))).toEqual([null]);
    expect(page(light).map((r) => r.getAttribute('data-theme'))).toEqual(['light']);
    expect(page(system).map((r) => r.getAttribute('data-theme'))).toEqual([null, 'light']);
    for (const card of [dark, light, system])
      expect(card.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe('AccentChoice', () => {
  it('draws each swatch as a root of its accent in the theme around it, ticked once chosen', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <UiRoot theme="light">
        <AccentChoice
          aria-label="Accent"
          options={ACCENTS}
          value="fuchsia"
          onValueChange={onValueChange}
        />
      </UiRoot>
    );
    const group = screen.getByRole('radiogroup', { name: 'Accent' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual(['Violet (default)', 'Fuchsia', 'Cyan']);
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    const swatches = radios.map((r) => r.querySelector('.jh-ui'));
    expect(swatches.map((s) => s.getAttribute('data-accent'))).toEqual([null, 'fuchsia', 'cyan']);
    for (const s of swatches) {
      expect(s).toHaveAttribute('data-theme', 'light');
      expect(s).toHaveAttribute('aria-hidden', 'true');
      expect(s).toHaveClass('size-7.5', 'rounded-full', 'bg-accent', 'text-on-accent');
    }
    // The chosen swatch's ring (the mock's .sw-on) and its tick.
    expect(swatches[1]).toHaveClass(
      'group-data-checked:ring-2',
      'group-data-checked:ring-text-1',
      'group-data-checked:ring-offset-surface-1'
    );
    expect(swatches[1].querySelector('svg')).toHaveClass('group-data-checked:opacity-100');
    await user.click(radios[2]);
    expect(onValueChange.mock.calls.at(-1)[0]).toBe('cyan');
  });

  it('in a dark root, sets no theme on the swatches (dark is the default)', () => {
    render(
      <UiRoot>
        <AccentChoice aria-label="Accent" options={ACCENTS} value="violet" />
      </UiRoot>
    );
    for (const r of screen.getAllByRole('radio'))
      expect(r.querySelector('.jh-ui')).not.toHaveAttribute('data-theme');
  });
});

describe('FontChoice', () => {
  it('draws each preset in its own face', () => {
    render(
      <FontChoice
        aria-label="Font family"
        options={[
          { value: 'default', label: 'Default', description: 'Manrope', family: "'Manrope'" },
          { value: 'sharp', label: 'Sharp', description: 'Rajdhani', family: "'Rajdhani'" },
        ]}
        value="sharp"
      />
    );
    const sharp = screen.getByRole('radio', { name: 'Sharp' });
    expect(sharp).toHaveAttribute('aria-checked', 'true');
    expect(sharp.style.fontFamily).toMatch(/Rajdhani/);
    expect(sharp).toHaveTextContent('Aa');
    expect(screen.getByRole('radiogroup', { name: 'Font family' })).toHaveAttribute(
      'data-slot',
      'font-choice'
    );
  });
});

describe('SettingRow and ToggleRow', () => {
  it('a ToggleRow’s switch is named by its name and described by its line', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <ToggleRow
        label="Clock"
        description="On the Overview"
        checked={false}
        onCheckedChange={onCheckedChange}
      />
    );
    const toggle = screen.getByRole('switch', { name: 'Clock' });
    expect(toggle).toHaveAccessibleDescription('On the Overview');
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(toggle.closest('[data-slot="setting-row"]')).toHaveClass(
      'px-panel',
      'py-3',
      'min-h-row'
    );
  });

  it('a disabled one stays as it is', () => {
    render(<ToggleRow label="Needs attention" checked disabled />);
    expect(screen.getByRole('switch', { name: 'Needs attention' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
  });

  it('a SettingRow draws its control with its ids, its name a heading when asked, children under', () => {
    render(
      <SettingRow
        titleAs="h3"
        label="Temperature unit"
        description="The weather’s"
        control={(ids) => (
          <SegmentedControl
            {...ids}
            options={[
              { value: 'F', label: '°F' },
              { value: 'C', label: '°C' },
            ]}
            value="F"
          />
        )}
      >
        <p>Under the row</p>
      </SettingRow>
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Temperature unit' })).toBeInTheDocument();
    const group = screen.getByRole('radiogroup', { name: 'Temperature unit' });
    expect(group).toHaveAccessibleDescription('The weather’s');
    expect(screen.getByText('Under the row')).toBeInTheDocument();
  });

  it('rows sit under a rule each; a named group of them is a section under its h3', () => {
    render(
      <SettingRows>
        <SettingBlock>
          <FieldGrid columns={3}>
            <span>a</span>
          </FieldGrid>
        </SettingBlock>
        <SettingRows title="Utilities" description="Beside the Overview">
          <ToggleRow label="Quick Launch" checked />
        </SettingRows>
      </SettingRows>
    );
    const group = screen.getByRole('region', { name: 'Utilities' });
    expect(within(group).getByRole('heading', { level: 3 })).toHaveTextContent('Utilities');
    expect(within(group).getByRole('switch', { name: 'Quick Launch' })).toBeChecked();
    expect(group.parentElement).toHaveClass('divide-y', 'divide-border');
    expect(screen.getByText('a').parentElement).toHaveClass('grid', 'gap-3', 'sm:grid-cols-3');
    expect(screen.getByText('a').closest('[data-slot="setting-block"]')).toHaveClass('p-panel');
  });
});

describe('ImagePicker', () => {
  it('is a group named by its label, with the preview, and picks a file', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const onClear = vi.fn();
    const { container } = render(
      <ImagePicker
        label="Logo"
        labelAs="h3"
        src="/logo.svg"
        alt="Logo"
        description="JagHelm’s logo"
        pickLabel="Upload New"
        onPick={onPick}
        clearLabel="Restore Default"
        onClear={onClear}
      />
    );
    const group = screen.getByRole('group', { name: 'Logo' });
    expect(screen.getByRole('heading', { level: 3, name: 'Logo' })).toBeInTheDocument();
    expect(within(group).getByRole('img', { name: 'Logo' })).toHaveClass('object-contain');
    const input = container.querySelector('input[type="file"]');
    expect(input).toHaveAttribute('accept', 'image/*');
    const click = vi.spyOn(input, 'click');
    await user.click(within(group).getByRole('button', { name: 'Upload New' }));
    expect(click).toHaveBeenCalled();
    const file = new File(['x'], 'logo.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onPick).toHaveBeenCalledWith(file);
    await user.click(within(group).getByRole('button', { name: 'Restore Default' }));
    expect(onClear).toHaveBeenCalled();
  });

  it('no clear button without onClear, no preview without an image, and an error says what failed', () => {
    render(
      <ImagePicker
        label="Image"
        wide
        pickLabel="Upload Image"
        error="Background upload failed: 413"
      />
    );
    const group = screen.getByRole('group', { name: 'Image' });
    expect(within(group).queryByRole('img')).toBeNull();
    expect(within(group).getAllByRole('button')).toHaveLength(1);
    expect(group).toHaveAccessibleDescription('Background upload failed: 413');
    expect(screen.getByText('Background upload failed: 413')).toHaveClass('text-crit-fg');
  });
});

describe('RangeField', () => {
  it('is a slider named by its label, in the accent, giving a number', () => {
    const onValueChange = vi.fn();
    render(
      <RangeField
        label="Image opacity: 30%"
        value={0.3}
        step={0.05}
        onValueChange={onValueChange}
      />
    );
    const slider = screen.getByRole('slider', { name: 'Image opacity: 30%' });
    expect(slider).toHaveClass('appearance-none', 'h-1.5', 'rounded-full');
    expect(slider.parentElement).toHaveClass('h-control');
    // The accent up to the value, surface-3 after it.
    expect(slider.style.backgroundImage).toMatch(
      /var\(--jh-accent\) 30%, var\(--jh-surface-3\) 30%/
    );
    fireEvent.change(slider, { target: { value: '0.55' } });
    expect(onValueChange).toHaveBeenCalledWith(0.55);
  });
});
