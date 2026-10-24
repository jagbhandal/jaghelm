/*
 * Settings → Nodes & Services' services (#319, spec §7): each node's
 * services, what JagHelm calls them and which Uptime Kuma monitor watches
 * each, drawn from props alone (the section, components/settings/
 * ServicesTab.jsx, owns services.yaml).
 *
 * ServiceMap: a panel with a disclosure per node (its icon, name and count),
 * and under an open one a row per service: its lamp (the service's
 * state, named), its name over its docker name in mono ("overridden" when
 * services.yaml changes it), its monitor tag, Hide or Show, and Edit.
 *
 * The monitor tag says what is true now. "monitored" names the monitor the
 * service really carries (`tag.monitor`); "no monitor" says none is
 * attached, whatever the service's own state; "opted out" says the
 * mapping is `monitor: false`, on purpose. A service that merely runs is
 * never "monitored".
 *
 * Edit opens the row's editor: the display name and icon, and the monitor,
 * chosen on purpose. The choice is Auto-match, No monitor or a monitor; under
 * it the matcher's suggestion for this service: the monitor Auto-match
 * would pick and why ("matched by name", "matched by a shared word"), or "no
 * match", with a button that pins the suggestion (Use <monitor>), and the
 * monitors with similar names, each one click to choose. Choosing anything
 * else overrides the suggestion.
 *
 * Props: `nodes` (each `{ key, name, icon, color, count, open, services }`; a
 * service `{ id, sub, name, state, stateWord, hidden, overridden, tag,
 * editing, editor }`; `tag` `{ kind: 'monitored'|'paused'|'none'|'opted-out',
 * monitor }`; `editor` `{ name, namePlaceholder, icon, monitor, monitorItems,
 * hint, suggestion, candidates, readOnly }`), `onToggleNode(key)`,
 * `onHide(id)`, `onEdit(id)`, `onName(id, text)`, `onIcon(id, text)`,
 * `onMonitor(id, choice)`, `onRemoveOverrides(id)`, `loading`, `saving`.
 */
import { useId } from 'react';
import { Check, ChevronDown, Minus } from 'lucide-react';
import { Button } from './button.jsx';
import { Confirm } from './confirm.jsx';
import { EmptyState } from './empty-state.jsx';
import { Field } from './field.jsx';
import { Input } from './input.jsx';
import { Panel } from './panel.jsx';
import { Select } from './select.jsx';
import { StatusLamp } from './status-lamp.jsx';
import { Switch } from './switch.jsx';
import { cn } from './lib/utils.js';

/** How the matcher matched a service to a monitor, in words (monitorMapping.js kinds). */
export function matchWords(kind) {
  if (kind === 'word') return 'matched by a shared word';
  return kind ? 'matched by name' : 'no match';
}

function MonitorTag({ tag }) {
  const kind = tag?.kind ?? 'none';
  const Icon = kind === 'monitored' ? Check : Minus;
  const word = { monitored: 'monitored', paused: 'monitor paused', 'opted-out': 'opted out', none: 'no monitor' }[kind];
  const named = (kind === 'monitored' || kind === 'paused') && tag.monitor;
  return (
    <span
      data-slot="monitor-tag"
      data-kind={kind}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-md border border-border px-2 py-0.5 text-caption',
        kind === 'monitored' ? 'bg-surface-2 text-text-1' : 'text-text-3'
      )}
    >
      <Icon aria-hidden="true" className="size-3 shrink-0" strokeWidth={2.25} />
      <span className="font-semibold">{word}</span>
      {named ? (
        <>
          <span aria-hidden="true">·</span>
          <span className="min-w-0 truncate font-mono text-text-2">{tag.monitor}</span>
        </>
      ) : null}
    </span>
  );
}

function Suggestion({ editor, name, onMonitor }) {
  const { suggestion, candidates = [], monitor, readOnly } = editor;
  const pinned = suggestion?.monitor != null && monitor === suggestion.monitor;
  const others = candidates.filter((c) => c.name !== suggestion?.monitor && c.name !== monitor);
  return (
    <div
      role="group"
      aria-label={`Auto-match suggestion for ${name}`}
      data-slot="monitor-suggestion"
      className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3 text-body-sm"
    >
      {suggestion?.monitor ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <p className="min-w-0 flex-1 text-text-2">
            Auto-match would pick <span className="font-mono font-semibold text-text-1">{suggestion.monitor}</span>
            <span className="text-text-3"> · {matchWords(suggestion.why)}</span>
          </p>
          {pinned ? (
            <span className="text-caption font-semibold text-text-3">Using this suggestion</span>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              disabled={readOnly}
              onClick={() => onMonitor(suggestion.monitor)}
            >
              Use {suggestion.monitor}
            </Button>
          )}
        </div>
      ) : (
        <p className="text-text-2">
          Auto-match finds no monitor for this service
          <span className="text-text-3">
            {candidates.some((c) => c.heldBy)
              ? ' that no other mapping holds'
              : ` by name or shared word: ${matchWords(null)}`}
          </span>
        </p>
      )}
      {others.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-caption text-text-3">Monitors with a similar name</p>
          <ul className="flex flex-wrap gap-1.5">
            {others.map((c) => (
              <li key={c.name}>
                {c.heldBy ? (
                  <span
                    data-slot="monitor-held"
                    className="inline-flex flex-wrap items-center gap-x-1.5 rounded-lg border border-border px-2.5 py-1 text-caption text-text-3"
                  >
                    <span className="font-mono">{c.name}</span>
                    <span>
                      mapped to {c.heldBy.container} on {c.heldBy.node}
                    </span>
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={readOnly}
                    onClick={() => onMonitor(c.name)}
                    className="border border-border"
                  >
                    Use <span className="font-mono">{c.name}</span>
                    <span className="font-sans font-normal text-text-3">{matchWords(c.kind)}</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Editor({ service, onName, onIcon, onMonitor, onRemoveOverrides }) {
  const { editor, name } = service;
  return (
    <div
      data-slot="service-editor"
      className="flex flex-col gap-4 border-t border-border px-panel py-4"
    >
      <div className="grid gap-4 @xl:grid-cols-2">
        <Field label="Display name">
          <Input
            value={editor.name}
            placeholder={editor.namePlaceholder}
            disabled={editor.readOnly}
            onChange={(e) => onName(e.target.value)}
          />
        </Field>
        <Field label="Icon key" description="Leave empty to pick one automatically.">
          <Input
            className="font-mono"
            value={editor.icon}
            placeholder="auto (e.g. npm, adguard, photoprism)"
            disabled={editor.readOnly}
            onChange={(e) => onIcon(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Uptime Kuma monitor" description={editor.hint}>
        <Select
          items={editor.monitorItems}
          value={editor.monitor}
          disabled={editor.readOnly}
          onValueChange={(value) => onMonitor(value)}
        />
      </Field>
      <Suggestion editor={editor} name={name} onMonitor={onMonitor} />
      {service.overridden ? (
        <div>
          <Confirm
            trigger={
              <Button variant="danger" size="sm" aria-label={`Remove all overrides for ${name}`}>
                Remove all overrides
              </Button>
            }
            title="Remove all overrides?"
            name={name}
            detail={service.sub}
            description="This clears the display name, icon and monitor mapping, on every node, restoring the auto-discovered defaults. This can't be undone."
            confirmLabel="Remove overrides"
            destructive
            onConfirm={onRemoveOverrides}
          />
        </div>
      ) : null}
    </div>
  );
}

function ServiceRow({ service, handlers }) {
  const { id, sub, name, hidden, overridden, tag, editing } = service;
  return (
    <li
      data-slot="service-row"
      data-service={id}
      className={cn('@container', hidden && 'bg-surface-2/40')}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-panel py-2.5">
        <StatusLamp state={service.state} label={service.stateWord} className="shrink-0" />
        <div className="flex min-w-0 flex-1 basis-40 flex-col">
          <span className="truncate text-body font-semibold text-text-1">{name}</span>
          <span className="truncate font-mono text-caption text-text-3">
            {sub}
            {overridden ? <span className="text-accent-text"> · overridden</span> : null}
            {hidden ? <span> · hidden</span> : null}
          </span>
        </div>
        <MonitorTag tag={tag} />
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label={`${hidden ? 'Show' : 'Hide'} ${name}`}
            onClick={() => handlers.onHide(id)}
          >
            {hidden ? 'Show' : 'Hide'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            tone="accent"
            aria-expanded={editing}
            aria-label={`${editing ? 'Close' : 'Edit'} ${name}`}
            onClick={() => handlers.onEdit(id)}
          >
            {editing ? 'Close' : 'Edit'}
          </Button>
        </div>
      </div>
      {editing && service.editor ? (
        <Editor
          service={service}
          onName={(v) => handlers.onName(id, v)}
          onIcon={(v) => handlers.onIcon(id, v)}
          onMonitor={(v) => handlers.onMonitor(id, v)}
          onRemoveOverrides={() => handlers.onRemoveOverrides(id)}
        />
      ) : null}
    </li>
  );
}

function NodeGroup({ node, handlers }) {
  const id = useId();
  return (
    <li data-slot="service-node" data-node={node.key}>
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={node.open}
          aria-controls={`${id}-list`}
          onClick={() => handlers.onToggleNode(node.key)}
          className="flex w-full cursor-pointer items-center gap-3 px-panel py-3 text-left transition-colors hover:bg-surface-2"
        >
          <span
            aria-hidden="true"
            className="inline-flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-2 text-body"
            style={node.color ? { boxShadow: `inset 3px 0 0 ${node.color}` } : undefined}
          >
            {node.icon}
          </span>
          <span className="min-w-0 flex-1 truncate text-body font-semibold text-text-1">
            {node.name}
          </span>
          <span className="shrink-0 text-caption text-text-3">
            {node.count} {node.count === 1 ? 'service' : 'services'}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn('size-4 shrink-0 text-text-2 transition-transform', node.open && 'rotate-180')}
          />
        </button>
      </h3>
      {node.open ? (
        <ul id={`${id}-list`} className="divide-y divide-border border-t border-border">
          {node.services.map((s) => (
            <ServiceRow key={s.id} service={s} handlers={handlers} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function ServiceMap({
  title = 'Services',
  description = 'Discovered from Prometheus and cAdvisor. Rename them, hide them, and choose which Uptime Kuma monitor watches each one.',
  nodes = [],
  loading = false,
  saving = false,
  onToggleNode,
  onHide,
  onEdit,
  onName,
  onIcon,
  onMonitor,
  onRemoveOverrides,
  className,
  ...props
}) {
  const handlers = { onToggleNode, onHide, onEdit, onName, onIcon, onMonitor, onRemoveOverrides };
  return (
    <Panel
      flush
      title={title}
      description={description}
      actions={
        saving ? (
          <span role="status" className="text-caption font-semibold text-text-3">
            Saving…
          </span>
        ) : null
      }
      className={className}
      {...props}
    >
      {nodes.length > 0 ? (
        <ul data-slot="service-map" className="divide-y divide-border">
          {nodes.map((node) => (
            <NodeGroup key={node.key} node={node} handlers={handlers} />
          ))}
        </ul>
      ) : (
        <EmptyState
          title={loading ? 'Reading services…' : 'No services discovered yet'}
          description={loading ? undefined : 'Check that Prometheus and cAdvisor are running.'}
        />
      )}
    </Panel>
  );
}

export { ServiceMap };

/*
 * BackupJobList (#319, spec §6.2): the cron jobs that have reported, each
 * with a switch to mark it as a backup. A backup is judged by the backup rule
 * (a failed last run is critical, an overdue one a warning) and listed under
 * Backups on the Overview; every other job stays under Jobs. A job is never a
 * backup by its name. A marked job that nothing reports any more says "not
 * reporting", so it can still be unmarked.
 *
 * Props: `rows` (each `{ key, node, job, backup, reporting }`),
 * `onToggle(key, backup)`, `loading`, `unread` (the jobs couldn't be read).
 */
function BackupJobList({
  title = 'Backup jobs',
  description = 'Mark the cron jobs that are backups. A failed run of a backup is critical and a late one a warning; other jobs only warn.',
  rows = [],
  onToggle,
  loading = false,
  unread = false,
  className,
  ...props
}) {
  return (
    <Panel flush title={title} description={description} className={className} {...props}>
      {rows.length > 0 ? (
        <ul data-slot="backup-jobs" className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.key} data-job={r.key} className="flex items-center gap-3 px-panel py-2.5">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-mono text-body-sm font-semibold text-text-1">
                  {r.job}
                </span>
                <span className="truncate text-caption text-text-3">
                  on {r.node}
                  {r.reporting ? null : ' · not reporting'}
                </span>
              </div>
              <Switch
                aria-label={`${r.job} on ${r.node} is a backup`}
                checked={r.backup}
                onCheckedChange={(on) => onToggle?.(r.key, on)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title={
            loading
              ? 'Reading jobs…'
              : unread
                ? 'The jobs couldn’t be read'
                : 'No cron job has reported yet'
          }
          description={
            loading || unread
              ? undefined
              : 'A job appears here after its first report to /api/cron/report. Mark the ones that are backups.'
          }
        />
      )}
    </Panel>
  );
}

export { BackupJobList };
