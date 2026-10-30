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

const dash = <span className="text-text-3">—</span>;

const KINDS = { nvme: 'NVMe', hdd: 'Hard disk', ssd: 'SSD', sata: 'SATA' };

const DRIVE_COLUMNS = [
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
    cell: (d) => (Number.isFinite(d.temperature) ? `${Math.round(d.temperature)} °C` : dash),
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

function DriveTable({ name, drives = [], ...props }) {
  return (
    <Table
      caption={`Drives on ${name}`}
      columns={DRIVE_COLUMNS}
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

export { DriveNode, DriveTable, RaidTable };
