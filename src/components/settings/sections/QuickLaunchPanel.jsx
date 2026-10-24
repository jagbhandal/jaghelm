import React, { useState } from 'react';
import {
  Actions,
  Announce,
  AppIcon,
  FieldRow,
  FormStack,
  GroupBox,
  GroupHead,
  Grow,
  IconSlot,
  InlineForm,
  MonoInput,
  Note,
  OrderedRows,
  Tray,
} from '@ui/apps-links';
import { Button } from '@ui/button';
import { Field } from '@ui/field';
import { Input } from '@ui/input';
import { Panel } from '@ui/panel';
import { appMonogram } from '@ui/side-nav';
import { useConfig } from '../../../context/ConfigContext.jsx';
import { useConfirm } from '../../../context/OverlayContext.jsx';
import { titleOf } from '../../../shell/utilities.js';
import { iconImageSrc, isEmoji } from '../../../utils/icon.jsx';
import IconPicker from '../../IconPicker';
import {
  groupKey,
  groupsIn,
  moved,
  normalizeAddress,
  reordered,
  shortAddress,
} from './appsLinksData.js';

/** The groups a fresh config starts with: they can be emptied but not removed. */
const DEFAULT_GROUPS = ['personal', 'management', 'devops'];

/**
 * Settings → Apps & links → Quick Launch links (#362): the config's `links`,
 * `{ group: [{ name, url, icon }] }`, as the Launch page, the utilities rail
 * and the command palette list them. Every group the config holds is listed
 * here, an empty one too and one that was saved as something other than a
 * list, so none is out of reach to fill or remove. Keys are only ever set
 * whole (never as a dotted path), so a group whose name has a "." edits like
 * the rest. A group's links are ordered by dragging or the Move buttons.
 */
export default function QuickLaunchPanel() {
  const { config, setConfig } = useConfig();
  const confirm = useConfirm();
  const groups = groupsIn(config.links);
  const [addingGroup, setAddingGroup] = useState(false);
  const [said, setSaid] = useState('');

  // One group's list, set whole.
  const setGroup = (key, change) =>
    setConfig((prev) => {
      const links = prev.links && typeof prev.links === 'object' ? prev.links : {};
      const now = Array.isArray(links[key]) ? links[key] : [];
      return { ...prev, links: { ...links, [key]: change(now) } };
    });

  const removeGroup = async (key) => {
    const name = titleOf(key);
    const ok = await confirm({
      title: `Remove the ${name} group?`,
      body: `This deletes the ${name} group and all of its links.`,
      confirmLabel: 'Remove group',
      danger: true,
    });
    if (!ok) return;
    setConfig((prev) => {
      const { [key]: _gone, ...rest } = prev.links || {};
      return { ...prev, links: rest };
    });
    setSaid(`Removed the ${name} group.`);
  };

  return (
    <Panel
      id="quick-launch-links"
      className="settings-anchor"
      title="Quick Launch links"
      description="Bookmarks in the utilities rail, the Launch page and ⌘K. Every group is listed here."
      actions={
        <Button size="sm" aria-expanded={addingGroup} onClick={() => setAddingGroup(!addingGroup)}>
          {addingGroup ? 'Close' : 'Add group'}
        </Button>
      }
    >
      {addingGroup ? (
        <AddGroup
          existing={groups.map((g) => g.key)}
          onAdd={(key) => {
            setConfig((prev) => ({
              ...prev,
              links: {
                ...(prev.links && typeof prev.links === 'object' ? prev.links : {}),
                [key]: [],
              },
            }));
            setAddingGroup(false);
            setSaid(`Added the ${titleOf(key)} group.`);
          }}
        />
      ) : null}
      {groups.length === 0 ? <Note>No groups yet. Add one to start your links.</Note> : null}
      {groups.map((group) => (
        <Group
          key={group.key}
          group={group}
          setGroup={(change) => setGroup(group.key, change)}
          onRemove={DEFAULT_GROUPS.includes(group.key) ? null : () => removeGroup(group.key)}
        />
      ))}
      <Announce>{said}</Announce>
    </Panel>
  );
}

function AddGroup({ existing, onAdd }) {
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const submit = (e) => {
    e.preventDefault();
    const key = groupKey(name);
    if (!key.replace(/_/g, '')) return setError('Give the group a name.');
    if (existing.includes(key)) return setError(`There is already a group called ${titleOf(key)}.`);
    onAdd(key);
  };
  return (
    <InlineForm onSubmit={submit}>
      <Grow>
        <Field label="Group name" error={error}>
          <Input
            value={name}
            placeholder="Media, Tools"
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
          />
        </Field>
      </Grow>
      <Button type="submit" variant="primary">
        Create group
      </Button>
    </InlineForm>
  );
}

function Group({ group, setGroup, onRemove }) {
  const [editing, setEditing] = useState(null); // a link's index
  const [adding, setAdding] = useState(false);
  const title = titleOf(group.key);
  const count = group.links.length;
  // A link has no id of its own: its place in the list is it, for as long as the list stands.
  const items = group.links.map((link, i) => {
    const name = link.name || shortAddress(link.url) || `Link ${i + 1}`;
    return {
      id: String(i),
      name,
      lead: (
        <AppIcon
          src={iconImageSrc(link.icon) ?? undefined}
          text={isEmoji(link.icon) ? link.icon : appMonogram(name)}
        />
      ),
      title: name,
      subtitle: shortAddress(link.url),
      actions: (
        <>
          <Button
            variant="ghost"
            size="sm"
            tone="accent"
            aria-label={`Edit ${name}`}
            aria-expanded={editing === i}
            onClick={() => setEditing(editing === i ? null : i)}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Remove ${name}`}
            onClick={() => {
              setGroup((list) => list.filter((_, j) => j !== i));
              setEditing(null);
            }}
          >
            Remove
          </Button>
        </>
      ),
      editor:
        editing === i ? (
          <LinkForm
            initial={link}
            submitLabel="Save"
            onSubmit={(next) => {
              setGroup((list) => list.map((l, j) => (j === i ? { ...l, ...next } : l)));
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        ) : null,
    };
  });

  return (
    <GroupBox title={title}>
      <GroupHead title={title} count={count}>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Add a link to ${title}`}
          aria-expanded={adding}
          onClick={() => setAdding(!adding)}
        >
          {adding ? 'Close' : 'Add link'}
        </Button>
        {onRemove ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Remove the ${title} group`}
            onClick={onRemove}
          >
            Remove group
          </Button>
        ) : null}
      </GroupHead>
      {adding ? (
        <Tray edge="top">
          <LinkForm
            submitLabel="Add link"
            onSubmit={(next) => {
              setGroup((list) => [...list, next]);
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        </Tray>
      ) : null}
      {count > 0 ? (
        <OrderedRows
          items={items}
          label={`${title} links`}
          onMove={(id, delta) => setGroup((list) => moved(list, Number(id), delta))}
          onReorder={(from, to) =>
            setGroup((list) => reordered(list, (_l, i) => String(i), from, to))
          }
        />
      ) : (
        <Note inset>No links in this group yet.</Note>
      )}
    </GroupBox>
  );
}

/** A link's name, address and icon: to add one, or to change one. */
function LinkForm({ initial = {}, submitLabel, onSubmit, onCancel }) {
  const [draft, setDraft] = useState({
    name: initial.name ?? '',
    url: initial.url ?? '',
    icon: initial.icon ?? '',
  });
  const [errors, setErrors] = useState({});
  const set = (patch) => {
    setDraft((d) => ({ ...d, ...patch }));
    setErrors({});
  };
  const submit = (e) => {
    e.preventDefault();
    const name = draft.name.trim();
    const address = normalizeAddress(draft.url);
    const found = {};
    if (!name) found.name = 'Give the link a name.';
    if (address.error) found.url = address.error;
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onSubmit({ name, url: address.url, icon: draft.icon.trim() || '🔗' });
  };
  return (
    <FormStack onSubmit={submit}>
      <FieldRow>
        <Field label="Name" error={errors.name}>
          <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="URL" error={errors.url}>
          <MonoInput
            value={draft.url}
            placeholder="https://"
            onChange={(e) => set({ url: e.target.value })}
          />
        </Field>
        <IconSlot>
          <IconPicker compact value={draft.icon} onChange={(icon) => set({ icon })} />
        </IconSlot>
      </FieldRow>
      <Actions>
        <Button type="submit" variant="primary" size="sm">
          {submitLabel}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </Actions>
    </FormStack>
  );
}
