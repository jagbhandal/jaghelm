/*
 * DetailStack (#642): the containers of a Compose stack, under the stack's
 * status in its detail (the desktop's drawer, the phone's sheet): the mock's
 * stack side panel. A heading "Containers · 4" with, at its end, the lead's
 * choice ("Set lead…") and "Ungroup"; then one line per member, the lead
 * first and tagged LEAD: its lamp (its own state, named), its
 * name, the model's word and reason under it (a failing one in its state's
 * colour; "Running" for one that is up), its image and node in mono, and
 * Details (its own detail) with, for one that isn't the lead, "Split
 * out" (it becomes a row of its own).
 *
 * The screens build `stack` (src/shell/detail/entityDetail.js): `{ count,
 * members: [{ id, name, state, word, reason, lead?, image?, where? }] }`. It draws nothing of its own state: the stack's status box is
 * the detail's, the heartbeats and response time are the lead's, and each
 * member's state is the model's. The edits are the screens' callbacks:
 * `onDetails(member)`, `onSetLead(member)`, `onUngroup()`, `onSplit(member)`;
 * without them (a read-only view) the controls are left out. `busy` while an
 * edit is sent, `error` (words) when it failed.
 */
import { Banner } from './banner.jsx';
import { Button } from './button.jsx';
import { Select } from './select.jsx';
import { StatusLamp } from './status-lamp.jsx';
import { cn } from './lib/utils.js';

const WORD_COLOUR = {
  ok: 'text-text-2',
  warn: 'text-warn-fg',
  crit: 'text-crit-fg',
  unknown: 'text-unknown-fg',
  maintenance: 'text-maintenance-fg',
};

/** What a member says under its name: "Running", or the model's reason in its colour. */
function sayOf(member) {
  if (member.state === 'ok') return member.word && member.word !== 'Up' ? member.word : 'Running';
  return member.reason || member.word;
}

function Member({ member, controls, busy, onDetails, onSplit }) {
  const where = [member.image, member.where].filter(Boolean).join(' · ');
  return (
    <li data-slot="stack-member" data-member={member.id} className="flex items-start gap-3 py-2.5">
      <StatusLamp state={member.state} label={member.word} className="mt-1.5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2">
          <span className="font-semibold text-text-1">{member.name}</span>
          {member.lead && (
            <span
              data-slot="stack-lead"
              className="rounded-md bg-accent-tint px-1.5 text-badge font-semibold text-accent-text uppercase"
            >
              Lead
            </span>
          )}
        </span>
        <span className={cn('text-body-sm', WORD_COLOUR[member.state])}>{sayOf(member)}</span>
        {where && <span className="font-mono text-caption wrap-anywhere text-text-3">{where}</span>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Button
          variant="secondary"
          size="sm"
          aria-label={`Details of ${member.name}`}
          onClick={() => onDetails?.(member)}
        >
          Details
        </Button>
        {controls && !member.lead && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label={`Split ${member.name} out of the stack`}
            onClick={() => onSplit?.(member)}
          >
            Split out
          </Button>
        )}
      </div>
    </li>
  );
}

function DetailStack({
  stack,
  onDetails,
  onSetLead,
  onUngroup,
  onSplit,
  busy = false,
  error = null,
  className,
  ...props
}) {
  if (!stack) return null;
  const members = stack.members ?? [];
  const controls = Boolean(onSetLead && onUngroup);
  const others = members.filter((m) => !m.lead);
  return (
    <section
      data-slot="detail-stack"
      aria-label={`Containers of ${stack.name ?? 'the stack'}`}
      className={cn('flex min-w-0 flex-col gap-1', className)}
      {...props}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h3 className="text-overline text-text-3 uppercase">Containers · {stack.count}</h3>
        {controls && (
          <div className="flex items-center gap-2">
            <Select
              aria-label="Set lead"
              placeholder="Set lead…"
              className="h-8 w-auto"
              items={others.map((m) => ({ value: m.id, label: m.name }))}
              value={null}
              disabled={busy || others.length === 0}
              onValueChange={(id) => {
                const member = others.find((m) => m.id === id);
                if (member) onSetLead(member);
              }}
            />
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => onUngroup()}>
              Ungroup
            </Button>
          </div>
        )}
      </div>
      {error && <Banner tone="unknown" title="Not saved" cause={error} />}
      <ul className="divide-y divide-border">
        {members.map((m) => (
          <Member
            key={m.id}
            member={m}
            controls={controls}
            busy={busy}
            onDetails={onDetails}
            onSplit={onSplit}
          />
        ))}
      </ul>
    </section>
  );
}

export { DetailStack };
