/*
 * The Monitoring page's Drives parts (#762): `DriveNode` is one node's block
 * (a heading, then what it holds, 12px apart; not a landmark, the panel is), `DriveTable` its drives as a
 * Table (the status model's lamp and word, the drive and its model, its kind,
 * its temperature, and the model's reason when it is not healthy) and
 * `RaidTable` its arrays (members active against how many it needs). Every
 * word is the server's (monitoringDrives.js); these draw it and judge nothing.
 * A reading that is missing is a dash, never a number or a healthy word.
 */
import { Table } from './table.jsx';
import { StateCell } from './lib/state-cell.jsx';
import { inTemperatureUnits, temperatureSymbol } from '../../server/status/readings.js';

const dash = <span className="text-text-3">—</span>;

// A drive's temperature is °C in the answer; it is drawn in the one `units`
// setting (#494), the unit the model's reason beside it is written in.
const degrees = (c, units) =>
  Number.isFinite(c) ? `${Math.round(inTemperatureUnits(c, units))} ${temperatureSymbol(units)}` : null;

const KINDS = { nvme: 'NVMe', hdd: 'Hard disk', ssd: 'SSD', sata: 'SATA' };

const driveColumns = (units) => [
  { key: 'state', header: 'State', cell: (d) => <StateCell state={d.state} word={d.word} /> },
  {
    key: 'device',
    header: 'Drive',
    cell: (d) => (
      <span>
        <span className="font-mono">{d.device}</span>
        {d.model && <span className="ml-2 text-caption text-text-3">{d.model}</span>}
      </span>
    ),
  },
  { key: 'type', header: 'Type', className: 'text-text-2', cell: (d) => KINDS[d.type] ?? d.type },
  {
    key: 'temperature',
    header: 'Temperature',
    numeric: true,
    cell: (d) => degrees(d.temperature, units) ?? dash,
  },
  {
    key: 'reason',
    header: 'Reason',
    className: 'text-text-2',
    cell: (d) =>
      d.state === 'ok' ? (
        dash
      ) : (
        <span className="block max-w-72 truncate" title={d.reason}>
          {d.reason}
        </span>
      ),
  },
];

const RAID_COLUMNS = [
  { key: 'state', header: 'State', cell: (a) => <StateCell state={a.state} word={a.word} /> },
  { key: 'device', header: 'Array', cell: (a) => <span className="font-mono">{a.device}</span> },
  {
    key: 'members',
    header: 'Members',
    numeric: true,
    cell: (a) => (Number.isFinite(a.active) && Number.isFinite(a.required) ? `${a.active} of ${a.required}` : dash),
  },
  { key: 'reason', header: 'Detail', className: 'text-text-2', cell: (a) => a.reason },
];

function DriveNode({ name, children, ...props }) {
  return (
    <div data-slot="drive-node" className="flex flex-col gap-3" {...props}>
      <h4 className="text-body-sm font-semibold">{name}</h4>
      {children}
    </div>
  );
}

function DriveTable({ name, drives = [], units = 'metric', ...props }) {
  return (
    <Table
      caption={`Drives on ${name}`}
      columns={driveColumns(units)}
      rows={drives}
      rowKey="key"
      minWidth={560}
      {...props}
    />
  );
}

function RaidTable({ name, arrays = [], ...props }) {
  return (
    <Table
      caption={`RAID arrays on ${name}`}
      columns={RAID_COLUMNS}
      rows={arrays}
      rowKey="device"
      minWidth={480}
      {...props}
    />
  );
}

/**
 * The phone's forms of the two tables (#763): a list of rows at the phone's
 * 16px gutter instead of a table that scrolls sideways. A row is the lamp and
 * word, the drive (or array) and what the table's other columns say, with the
 * model's reason in full beneath it (the table truncates it). The same words.
 */
function ListRows({ label, children, ...props }) {
  return (
    <ul
      aria-label={label}
      data-slot="drive-list"
      className="m-0 flex list-none flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface-1 p-0"
      {...props}
    >
      {children}
    </ul>
  );
}

function ListRow({ state, head, facts, reason }) {
  return (
    <li className="flex min-w-0 flex-col gap-1 border-t border-border-subtle px-3 py-2.5 first:border-t-0">
      <div className="flex min-w-0 items-center justify-between gap-3">
        {state}
        <span className="text-body-sm tabular-nums text-text-2">{facts}</span>
      </div>
      <div className="min-w-0 text-body-sm">{head}</div>
      {reason && <p className="m-0 text-caption break-words text-text-2">{reason}</p>}
    </li>
  );
}

function DriveList({ name, drives = [], units = 'metric', ...props }) {
  return (
    <ListRows label={`Drives on ${name}`} {...props}>
      {drives.map((d) => (
        <ListRow
          key={d.key}
          state={<StateCell state={d.state} word={d.word} />}
          head={
            <>
              <span className="font-mono">{d.device}</span>
              {d.model && <span className="ml-2 text-caption text-text-3">{d.model}</span>}
            </>
          }
          facts={`${KINDS[d.type] ?? d.type} · ${degrees(d.temperature, units) ?? '—'}`}
          reason={d.state === 'ok' ? null : d.reason}
        />
      ))}
    </ListRows>
  );
}

function RaidList({ name, arrays = [], ...props }) {
  return (
    <ListRows label={`RAID arrays on ${name}`} {...props}>
      {arrays.map((a) => (
        <ListRow
          key={a.device}
          state={<StateCell state={a.state} word={a.word} />}
          head={<span className="font-mono">{a.device}</span>}
          facts={Number.isFinite(a.active) && Number.isFinite(a.required) ? `${a.active} of ${a.required} members` : '—'}
          reason={a.reason}
        />
      ))}
    </ListRows>
  );
}

export { DriveNode, DriveTable, RaidTable, DriveList, RaidList };
