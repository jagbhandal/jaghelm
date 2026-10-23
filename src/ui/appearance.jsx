/*
 * Settings → Appearance's controls (#321, spec §7), as the mock's Settings
 * board draws them; src/components/settings/sections/Appearance.jsx wires
 * them to the theme and the display config.
 *
 *   ThemeChoice   the theme as three cards in a radio group: each a preview
 *                 of the page colour (dark, light, and the two halved for
 *                 system), its name and its line. The chosen card has the
 *                 accent's 1.5px inset ring instead of its edge.
 *   AccentChoice  the accents as 30px round swatches in a radio group, each
 *                 named under it; the chosen one carries a tick in
 *                 on-accent and a ring in text-1 2px off it. A swatch is a
 *                 root of its own with that accent and the theme around it,
 *                 so it is drawn in tokens.css's own colour, never a copy.
 *   FontChoice    the font presets as cards like ThemeChoice's, each drawn
 *                 in its own face: "Aa", its name and its pairing.
 *   SettingRow    a setting as a row of a list: its name (13px semibold) and
 *                 line (12px text-3), and the control at the end, which
 *                 `control(ids)` draws, named and described by them (spread
 *                 `ids` on it); `children` go under, such as a place's
 *                 fields. `titleAs="h3"` makes its name a heading, for a
 *                 part of the page a link can open at. Rows sit in a Panel
 *                 with `flush`, each under a subtle rule.
 *   ToggleRow     a SettingRow whose control is a Switch.
 *   SettingRows   the rows of a Panel with `flush`, a subtle rule between
 *                 each; with a `title` (an h3) and `description`, a named
 *                 group of them inside another list. A SettingBlock is a
 *                 row that holds fields, inside the panel's padding.
 *   FieldGrid     fields side by side from 640px, 2 or 3 across; stacked on
 *                 a phone.
 *   ImagePicker   an image chosen from a file: its label (`labelAs="h3"`
 *                 for a heading), a preview (`wide`
 *                 for a background, cover; else a 48px square, contain),
 *                 `pickLabel` and `clearLabel` buttons, and an error in
 *                 crit's word colour with its icon.
 *   RangeField    a value on a slider, its label saying the value: a 6px
 *                 bar, the accent up to the value and surface-3 after, and
 *                 a 16px white thumb in a 2px accent ring (switch-thumb,
 *                 shadow-thumb, as the Switch's), on a 34px row so it is as
 *                 easy to hit as a control.
 *
 * Every control applies at once: there is no preview (spec M10).
 */
import { useContext, useId, useRef } from 'react';
import { RadioGroup } from '@base-ui/react/radio-group';
import { Radio } from '@base-ui/react/radio';
import { Check, CircleAlert } from 'lucide-react';
import { Button } from './button.jsx';
import { Switch } from './switch.jsx';
import { ROOT_CLASS, RootSwitchesContext, switchAttributes } from './lib/portal.js';
import { cn } from './lib/utils.js';

const CARD =
  'flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-lg border border-border bg-surface-1 p-3 text-left text-body-sm text-text-1 transition-colors hover:border-border-strong data-checked:border-transparent data-checked:inset-ring-[1.5px] data-checked:inset-ring-accent';

/** A radio group of cards: each option's preview (`preview(option)`), name and line. */
function CardGroup({ options, preview, className, ...props }) {
  const id = useId();
  return (
    <RadioGroup className={cn('grid gap-3 sm:grid-cols-3', className)} {...props}>
      {options.map((option) => {
        const name = `${id}${option.value}`;
        return (
          <Radio.Root
            key={option.value}
            value={option.value}
            nativeButton
            render={<button type="button" />}
            aria-labelledby={name}
            aria-describedby={option.description ? `${name}desc` : undefined}
            style={option.family ? { fontFamily: option.family } : undefined}
            className={CARD}
          >
            {preview(option)}
            <span id={name} className="font-semibold">
              {option.label}
            </span>
            {option.description ? (
              <span id={`${name}desc`} className="text-caption text-text-3">
                {option.description}
              </span>
            ) : null}
          </Radio.Root>
        );
      })}
    </RadioGroup>
  );
}

// A theme's page colour, drawn by a root in that theme.
const PAGE = 'h-13 rounded-lg border border-border bg-background';

function ThemePreview({ theme }) {
  if (theme === 'system') {
    return (
      <span aria-hidden="true" className="flex h-13 overflow-hidden rounded-lg">
        <span className={cn(ROOT_CLASS, PAGE, 'flex-1 rounded-r-none border-r-0')} />
        <span
          {...switchAttributes({ theme: 'light' })}
          className={cn(ROOT_CLASS, PAGE, 'flex-1 rounded-l-none border-l-0')}
        />
      </span>
    );
  }
  return (
    <span aria-hidden="true" {...switchAttributes({ theme })} className={cn(ROOT_CLASS, PAGE)} />
  );
}

function ThemeChoice({ options, ...props }) {
  return (
    <CardGroup
      data-slot="theme-choice"
      options={options}
      preview={(o) => <ThemePreview theme={o.value} />}
      {...props}
    />
  );
}

function FontChoice({ options, ...props }) {
  return (
    <CardGroup
      data-slot="font-choice"
      options={options}
      preview={() => (
        <span aria-hidden="true" className="text-title">
          Aa
        </span>
      )}
      {...props}
    />
  );
}

function AccentChoice({ options, className, ...props }) {
  // Each swatch is drawn in the theme of the root around it.
  const theme = useContext(RootSwitchesContext)?.['data-theme'];
  return (
    <RadioGroup
      data-slot="accent-choice"
      className={cn('flex flex-wrap items-start gap-4', className)}
      {...props}
    >
      {options.map(({ value, label }) => (
        <Radio.Root
          key={value}
          value={value}
          nativeButton
          render={<button type="button" />}
          className="group flex cursor-pointer flex-col items-center gap-1.5 rounded-lg p-1 text-caption text-text-2 transition-colors hover:text-text-1 data-checked:text-text-1"
        >
          <span
            aria-hidden="true"
            {...switchAttributes({ theme, accent: value })}
            className={cn(
              ROOT_CLASS,
              'inline-flex size-7.5 items-center justify-center rounded-full bg-accent text-on-accent group-data-checked:ring-2 group-data-checked:ring-text-1 group-data-checked:ring-offset-2 group-data-checked:ring-offset-surface-1'
            )}
          >
            <Check
              className="size-3.5 opacity-0 group-data-checked:opacity-100"
              strokeWidth={2.5}
            />
          </span>
          {label}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}

function SettingRow({
  label,
  description,
  control,
  titleAs = 'span',
  className,
  children,
  ...props
}) {
  const Title = titleAs;
  const id = useId();
  const ids = {
    'aria-labelledby': `${id}label`,
    'aria-describedby': description != null ? `${id}desc` : undefined,
  };
  return (
    <div
      data-slot="setting-row"
      className={cn('flex min-h-row flex-col gap-3 px-panel py-3', className)}
      {...props}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Title id={ids['aria-labelledby']} className="text-body-sm font-semibold text-text-1">
            {label}
          </Title>
          {description != null ? (
            <span id={ids['aria-describedby']} className="text-caption text-text-3">
              {description}
            </span>
          ) : null}
        </div>
        {control(ids)}
      </div>
      {children}
    </div>
  );
}

function ToggleRow({ checked, onCheckedChange, disabled, ...props }) {
  return (
    <SettingRow
      control={(ids) => (
        <Switch
          {...ids}
          checked={checked}
          disabled={disabled}
          onCheckedChange={(on) => onCheckedChange?.(on)}
        />
      )}
      {...props}
    />
  );
}

const ROWS = 'flex flex-col divide-y divide-border';

function SettingRows({ title, description, className, children, ...props }) {
  const id = useId();
  if (title == null) {
    return (
      <div data-slot="setting-rows" className={cn(ROWS, className)} {...props}>
        {children}
      </div>
    );
  }
  return (
    <section
      data-slot="setting-rows"
      aria-labelledby={`${id}title`}
      className={cn('flex flex-col', className)}
      {...props}
    >
      <div className="flex flex-col gap-0.5 px-panel pt-3">
        <h3 id={`${id}title`} className="text-body-sm font-semibold text-text-1">
          {title}
        </h3>
        {description != null ? <p className="text-caption text-text-3">{description}</p> : null}
      </div>
      <div className={ROWS}>{children}</div>
    </section>
  );
}

function SettingBlock({ className, ...props }) {
  return (
    <div
      data-slot="setting-block"
      className={cn('flex flex-col gap-4 p-panel', className)}
      {...props}
    />
  );
}

const ACROSS = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3' };

function FieldGrid({ columns = 2, className, ...props }) {
  return (
    <div
      data-slot="field-grid"
      className={cn('grid gap-3', ACROSS[columns] ?? ACROSS[2], className)}
      {...props}
    />
  );
}

/** An error under a control, as a Field draws one: crit's word colour, with its icon. */
function ControlError({ id, children }) {
  return (
    <p id={id} className="flex items-start gap-1.5 text-caption text-crit-fg">
      <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" strokeWidth={2} />
      {children}
    </p>
  );
}

function ImagePicker({
  label,
  labelAs = 'span',
  src,
  alt = '',
  description,
  pickLabel,
  onPick,
  clearLabel,
  onClear,
  error,
  wide = false,
  accept = 'image/*',
  className,
  ...props
}) {
  const Label = labelAs;
  const id = useId();
  const input = useRef(null);
  return (
    <div
      role="group"
      aria-labelledby={`${id}label`}
      aria-describedby={error ? `${id}error` : undefined}
      data-slot="image-picker"
      className={cn('flex min-w-0 flex-col gap-1.5', className)}
      {...props}
    >
      <Label id={`${id}label`} className="text-body-sm font-semibold text-text-1">
        {label}
      </Label>
      <div className="flex flex-wrap items-center gap-3">
        {src ? (
          <span
            className={cn(
              'flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-2',
              wide ? 'h-16 w-28' : 'size-12 p-1.5'
            )}
          >
            <img
              src={src}
              alt={alt}
              className={cn('size-full', wide ? 'object-cover' : 'object-contain')}
            />
          </span>
        ) : null}
        <div className="flex min-w-0 flex-col gap-1.5">
          {description != null ? (
            <span className="text-caption text-text-3">{description}</span>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => input.current?.click()}>
              {pickLabel}
            </Button>
            {onClear ? (
              <Button size="sm" variant="ghost" onClick={onClear}>
                {clearLabel}
              </Button>
            ) : null}
          </div>
        </div>
        <input
          ref={input}
          type="file"
          accept={accept}
          hidden
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onPick?.(file);
          }}
        />
      </div>
      {error ? <ControlError id={`${id}error`}>{error}</ControlError> : null}
    </div>
  );
}

// The thumb, in WebKit and Firefox alike: the Switch's white thumb in an accent ring.
const THUMB =
  '[&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-accent [&::-webkit-slider-thumb]:bg-switch-thumb [&::-webkit-slider-thumb]:shadow-thumb [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-accent [&::-moz-range-thumb]:bg-switch-thumb [&::-moz-range-thumb]:shadow-thumb [&::-moz-range-track]:bg-transparent';

function RangeField({ label, value, min = 0, max = 1, step, onValueChange, className, ...props }) {
  // The bar is the input's own background: the accent up to the value.
  const filled = max > min ? Math.round(((value - min) / (max - min)) * 1000) / 10 : 0;
  const bar = `linear-gradient(to right, var(--jh-accent) ${filled}%, var(--jh-surface-3) ${filled}%)`;
  return (
    <label data-slot="range-field" className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <span className="text-body-sm font-semibold text-text-1">{label}</span>
      <span className="flex h-control items-center">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onValueChange?.(parseFloat(e.target.value))}
          style={{ backgroundImage: bar }}
          className={cn('h-1.5 w-full cursor-pointer appearance-none rounded-full', THUMB)}
          {...props}
        />
      </span>
    </label>
  );
}

export {
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
};
