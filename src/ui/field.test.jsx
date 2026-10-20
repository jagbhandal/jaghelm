import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { Field } from '@ui/field';
import { Input } from '@ui/input';
import { Select } from '@ui/select';
import { Switch } from '@ui/switch';
import { Checkbox } from '@ui/checkbox';
import { SegmentedControl } from '@ui/segmented-control';

describe('Field', () => {
  it('labels its control and lays out label, control and help text as the mock does', () => {
    render(
      <Field label="Instance name" description="Shown in the sidebar and the browser tab.">
        <Input />
      </Field>
    );
    const input = screen.getByRole('textbox', { name: 'Instance name' });
    const label = screen.getByText('Instance name');
    expect(label.tagName).toBe('LABEL');
    expect(label).toHaveClass('text-body-sm', 'font-semibold', 'text-text-1');
    const help = screen.getByText('Shown in the sidebar and the browser tab.');
    expect(help).toHaveClass('text-caption', 'text-text-3');
    expect(label.parentElement).toHaveClass('flex', 'flex-col', 'gap-1.5');
    expect(input).toHaveAccessibleDescription('Shown in the sidebar and the browser tab.');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('moves focus to the control when its label is clicked', async () => {
    const user = userEvent.setup();
    render(
      <Field label="Subtitle">
        <Input />
      </Field>
    );
    await user.click(screen.getByText('Subtitle'));
    expect(screen.getByRole('textbox', { name: 'Subtitle' })).toHaveFocus();
  });

  it('wires an error with aria-describedby and aria-invalid, beside the help text', () => {
    render(
      <Field
        label="URL"
        description="Where JagHelm reaches the app."
        error="Enter a URL that starts with https://"
      >
        <Input />
      </Field>
    );
    const input = screen.getByRole('textbox', { name: 'URL' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const help = screen.getByText('Where JagHelm reaches the app.');
    const error = screen.getByText('Enter a URL that starts with https://');
    const ids = input.getAttribute('aria-describedby').split(' ');
    expect(ids).toContain(help.id);
    expect(ids).toContain(error.id);
    expect(input).toHaveAccessibleDescription(
      'Where JagHelm reaches the app. Enter a URL that starts with https://'
    );
    // The error is a word in crit's colour with an icon, never colour alone.
    expect(error).toHaveClass('text-caption', 'text-crit-fg');
    expect(error.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('drops aria-invalid and the error once the error is gone', () => {
    const { rerender } = render(
      <Field label="Name" error="Required">
        <Input />
      </Field>
    );
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute('aria-invalid', 'true');
    rerender(
      <Field label="Name">
        <Input />
      </Field>
    );
    expect(screen.getByRole('textbox', { name: 'Name' })).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText('Required')).toBeNull();
  });

  it('labels a Select without a <label>, so clicking the label focuses it and leaves it shut', async () => {
    const user = userEvent.setup();
    render(
      <Field label="Data refresh" description="How often the server polls.">
        <Select items={[{ value: '30', label: 'Every 30 s' }]} defaultValue="30" />
      </Field>
    );
    const trigger = screen.getByRole('combobox', { name: 'Data refresh' });
    expect(trigger).toHaveAccessibleDescription('How often the server polls.');
    const label = screen.getByText('Data refresh');
    expect(label.tagName).not.toBe('LABEL');
    await user.click(label);
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows no error and sets no aria-invalid when told invalid={false}', () => {
    render(
      <Field label="Name" error="Required" invalid={false}>
        <Input />
      </Field>
    );
    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText('Required')).toBeNull();
    expect(input).not.toHaveAccessibleDescription();
  });

  it('labels a Select wrapped in another component without a <label> too', async () => {
    const user = userEvent.setup();
    function RefreshPicker() {
      return (
        <div className="flex gap-2">
          <Select items={[{ value: '30', label: 'Every 30 s' }]} defaultValue="30" />
        </div>
      );
    }
    render(
      <Field label="Data refresh">
        <RefreshPicker />
      </Field>
    );
    const trigger = screen.getByRole('combobox', { name: 'Data refresh' });
    const label = screen.getByText('Data refresh');
    expect(label.tagName).not.toBe('LABEL');
    await user.click(label);
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('labels with a <label> again once its Select is gone', () => {
    const { rerender } = render(
      <Field label="Refresh">
        <Select items={[{ value: '30', label: 'Every 30 s' }]} defaultValue="30" />
      </Field>
    );
    expect(screen.getByText('Refresh').tagName).not.toBe('LABEL');
    rerender(
      <Field label="Refresh">
        <Input />
      </Field>
    );
    expect(screen.getByText('Refresh').tagName).toBe('LABEL');
  });

  it('names and describes a SegmentedControl as a group, each segment by its own text', () => {
    render(
      <Field label="Density" description="Compact fits more rows.">
        <SegmentedControl
          options={[
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'compact', label: 'Compact' },
          ]}
          defaultValue="compact"
        />
      </Field>
    );
    const group = screen.getByRole('radiogroup', { name: 'Density' });
    expect(group).toHaveAccessibleDescription('Compact fits more rows.');
    // The label names the group, as a legend would, so it is no <label>.
    expect(screen.getByText('Density').tagName).not.toBe('LABEL');
    const comfortable = screen.getByRole('radio', { name: 'Comfortable' });
    const compact = screen.getByRole('radio', { name: 'Compact' });
    expect(compact).toHaveAttribute('aria-checked', 'true');
    expect(comfortable.id).not.toBe(compact.id);
    expect(document.querySelectorAll(`[id="${compact.id}"]`)).toHaveLength(1);
  });

  it('labels and describes a Switch and a Checkbox', () => {
    render(
      <>
        <Field label="Weekly digest" description="Sundays at 14:00.">
          <Switch />
        </Field>
        <Field label="Open in a new tab" error="Embedding is blocked">
          <Checkbox />
        </Field>
      </>
    );
    expect(screen.getByRole('switch', { name: 'Weekly digest' })).toHaveAccessibleDescription(
      'Sundays at 14:00.'
    );
    const box = screen.getByRole('checkbox', { name: 'Open in a new tab' });
    expect(box).toHaveAccessibleDescription('Embedding is blocked');
    expect(box).toHaveAttribute('aria-invalid', 'true');
  });

  it('disables its control', () => {
    render(
      <Field label="API key" disabled>
        <Input />
      </Field>
    );
    expect(screen.getByRole('textbox', { name: 'API key' })).toBeDisabled();
  });
});
