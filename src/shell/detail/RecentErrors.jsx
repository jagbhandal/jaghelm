/**
 * The detail's "Recent errors" (#672): a node's or a container's last
 * error-ish log lines from Loki (useLogPeek.js), drawn as DetailLogs
 * (src/ui). EntityDrawer draws it in EntityDetail's `logs` slot, for a view
 * with a `chart` target (a node, or a service or container with a container:
 * entityDetail.js chartTarget), and the phone's sheet in the same place
 * (PhoneDetail.jsx). It is in the detail's chunk, so out of the first load,
 * and reads nothing until the detail is open.
 */
import { DetailLogs } from '@ui/detail-logs';
import { useLogPeek } from './useLogPeek.js';

/**
 * @param {{ target: { kind: string, entity: string }, updated?: any, paused?: boolean }} props
 *   `updated`: the header's status poll (useStatus), whose answers pace the reads
 */
export function RecentErrors({ target, updated, paused = false }) {
  const read = useLogPeek(target, updated, { paused });
  return <DetailLogs state={read.state} lines={read.lines} reason={read.reason} />;
}
