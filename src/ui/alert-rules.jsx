/*
 * Settings → Notifications → Alert rules (#669), the parts that are not a
 * plain setting row: the quiet hours' times and mode, the known causes' rows
 * and the list of what Snooze and Ack are silencing. Presentational: the
 * section (components/settings/sections/AlertRules.jsx) holds the config and
 * the server's view and passes values and handlers; nothing here reads either.
 *
 *  - QuietTimes: two time Inputs ("From", "Until"), a two-way segmented
 *    control for what rings meanwhile and the time zone the hours are in (a
 *    Select over `zones`, `zoneNote` saying where the zone comes from and `zoneError` why a pick was refused (both tied to the Select), and
 *    a ghost button that takes the device's zone), in one wrapping row (#703).
 *  - CauseRows: a SettingRows block titled "Known causes"; a row per cause
 *    with its two Inputs ("Name contains", "Label") and a ghost Delete, and
 *    an "Add a known cause" button under them. Each row is a
 *    `data-cause-row`.
 *  - SilencedRows: a SettingRows block, a row per silenced tag with what
 *    silences it (`text`, in `text-3`) and a ghost Lift; one line of words
 *    when there is none, or when the server could not be read. Each row is a
 *    `data-silenced-row`.
 */
import { Button } from './button.jsx';
import { Field } from './field.jsx';
import { Input } from './input.jsx';
import { Select } from './select.jsx';
import { SegmentedControl } from './segmented-control.jsx';
import { SettingRows } from './appearance.jsx';

function QuietTimes({
  start,
  end,
  mode,
  modes,
  onStart,
  onEnd,
  onMode,
  zone,
  zones,
  zoneNote,
  zoneError,
  onZone,
  deviceZone,
  onDeviceZone,
  disabled,
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="From" className="w-32">
          <Input
            type="time"
            value={start}
            disabled={disabled}
            onChange={(e) => e.target.value && onStart(e.target.value)}
          />
        </Field>
        <Field label="Until" className="w-32">
          <Input
            type="time"
            value={end}
            disabled={disabled}
            onChange={(e) => e.target.value && onEnd(e.target.value)}
          />
        </Field>
        <SegmentedControl
          aria-label="During quiet hours"
          options={modes}
          value={mode}
          disabled={disabled}
          onValueChange={onMode}
        />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field
          label="Time zone"
          description={zoneNote || undefined}
          error={zoneError || undefined}
          className="w-72 max-w-full"
        >
          <Select items={zones} value={zone} disabled={disabled} onValueChange={onZone} />
        </Field>
        {deviceZone ? (
          <Button variant="ghost" size="sm" disabled={disabled} onClick={onDeviceZone}>
            Use this device’s zone ({deviceZone})
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function CauseRows({
  causes,
  onChange,
  onDelete,
  onAdd,
  disabled,
  canAdd,
  matchMax,
  labelMax,
  ...props
}) {
  return (
    <SettingRows
      title="Known causes"
      description="An alert whose service or host name holds the text gets the label, on the push and on the Alerts page. A row needs both a name and a label."
      {...props}
    >
      {causes.map((c, i) => (
        <div key={i} className="flex flex-wrap items-end gap-3 px-panel py-3" data-cause-row>
          <Field label="Name contains" className="min-w-40 flex-1">
            <Input
              value={c.match ?? ''}
              maxLength={matchMax}
              disabled={disabled}
              onChange={(e) => onChange(i, { match: e.target.value })}
            />
          </Field>
          <Field label="Label" className="min-w-56 flex-[2]">
            <Input
              value={c.label ?? ''}
              maxLength={labelMax}
              disabled={disabled}
              onChange={(e) => onChange(i, { label: e.target.value })}
            />
          </Field>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            aria-label={`Delete the cause “${c.label || c.match}”`}
            onClick={() => onDelete(i)}
          >
            Delete
          </Button>
        </div>
      ))}
      <div className="flex px-panel py-3">
        <Button variant="secondary" size="sm" disabled={disabled || !canAdd} onClick={onAdd}>
          Add a known cause
        </Button>
      </div>
    </SettingRows>
  );
}

function SilencedRows({ rows, error, onLift, disabled, ...props }) {
  return (
    <SettingRows
      title="Snoozed and acknowledged"
      description="From a notification's Snooze 1h and Ack buttons. Lift one here to hear about it again."
      {...props}
    >
      {error ? (
        <p className="px-panel py-3 text-body-sm text-text-2">Couldn’t read what is snoozed.</p>
      ) : rows.length === 0 ? (
        <p className="px-panel py-3 text-body-sm text-text-2">
          Nothing is snoozed or acknowledged.
        </p>
      ) : (
        rows.map((r) => (
          <div
            key={r.tag}
            className="flex flex-wrap items-center gap-3 px-panel py-3"
            data-silenced-row
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-body-sm font-semibold text-text-1 wrap-anywhere">{r.tag}</span>
              <span className="text-caption text-text-3">{r.text}</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              aria-label={`Lift for ${r.tag}`}
              onClick={() => onLift(r.tag)}
            >
              Lift
            </Button>
          </div>
        ))
      )}
    </SettingRows>
  );
}

export { QuietTimes, CauseRows, SilencedRows };
