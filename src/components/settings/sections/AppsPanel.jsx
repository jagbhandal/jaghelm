import React, { useEffect, useRef, useState } from 'react';
import {
  Actions,
  Announce,
  AppIcon,
  CheckWord,
  Column,
  FieldRow,
  FormStack,
  IconSlot,
  MonoInput,
  Note,
  OrderedRows,
  ToggleLine,
  Tray,
} from '@ui/apps-links';
import { Banner } from '@ui/banner';
import { Button } from '@ui/button';
import { Field } from '@ui/field';
import { Input } from '@ui/input';
import { Panel } from '@ui/panel';
import { Switch } from '@ui/switch';
import { appMonogram } from '@ui/side-nav';
import { checkEmbedUrl } from '../../../api/embedCheck.js';
import { useConfig } from '../../../context/ConfigContext.jsx';
import { useConfirm } from '../../../context/OverlayContext.jsx';
import { iconImageSrc } from '../../../utils/icon.jsx';
import IconPicker from '../../IconPicker';
import {
  appsIn,
  embeddingWord,
  moved,
  newAppId,
  normalizeAddress,
  reordered,
  shortAddress,
  useEmbeddingChecks,
  checkSavedApp,
} from './appsLinksData.js';

/**
 * Settings → Apps & links → Embedded apps (#362): the config's `tabs`, each an
 * app that opens inside JagHelm (or, set to, in a new browser tab). Its name,
 * address, icon (from the icon index) and order are the config's, and the
 * sidebar's Apps group and the command palette list the apps in that order.
 *
 * Adding an app asks the server whether the app's own headers let a browser
 * frame it (POST /api/embed-check) and says so before anything is saved: an
 * app that embeds is added at once; one that blocks, or whose headers could
 * not be read, waits for the choice (open it in a new tab instead, add it
 * inside JagHelm anyway, or go back). Each listed app shows its own check.
 *
 * `initial`, for the gallery: `{ form, phase }` opens the add form with that
 * form filled and `phase` (the check's answer, `{ app, result }`) showing.
 */
export default function AppsPanel({
  checkEmbed = checkEmbedUrl,
  checkSaved = checkSavedApp,
  initial = null,
}) {
  const { config, setConfig } = useConfig();
  const confirm = useConfirm();
  const tabs = Array.isArray(config.tabs) ? config.tabs : [];
  const apps = appsIn(tabs);
  const { results, seed, reserve } = useEmbeddingChecks(apps, checkSaved);
  const [adding, setAdding] = useState(Boolean(initial?.form));
  const [editing, setEditing] = useState(null);
  const [said, setSaid] = useState('');
  const addButton = useRef(null);
  // The last app removed leaves no row to take focus: the Add button does.
  const count = useRef(apps.length);
  useEffect(() => {
    if (apps.length === 0 && count.current > 0) addButton.current?.focus();
    count.current = apps.length;
  });

  // The apps in a new order, in the slots the apps held among the tabs.
  const setApps = (next) =>
    setConfig((prev) => {
      const all = Array.isArray(prev.tabs) ? prev.tabs : [];
      let i = 0;
      return { ...prev, tabs: all.map((t) => (appsIn([t]).length ? next[i++] : t)) };
    });
  const idOf = (a) => String(a.id);

  const add = (app, result) => {
    setConfig((prev) => ({ ...prev, tabs: [...(Array.isArray(prev.tabs) ? prev.tabs : []), app] }));
    if (result) seed(app.url, result);
    setAdding(false);
    setSaid(
      app.newTab
        ? `Added ${app.label}. It opens in a new tab.`
        : `Added ${app.label} to the sidebar.`
    );
  };

  const replace = (id, patch) =>
    setConfig((prev) => ({
      ...prev,
      tabs: (prev.tabs || []).map((t) => (String(t?.id) === id ? { ...t, ...patch } : t)),
    }));

  const remove = async (app) => {
    const name = app.label || String(app.id);
    const ok = await confirm({
      title: `Remove ${name}?`,
      body: `${name} leaves the sidebar and the command palette. Its address and icon are forgotten.`,
      confirmLabel: 'Remove app',
      danger: true,
    });
    if (!ok) return;
    setConfig((prev) => ({
      ...prev,
      tabs: (prev.tabs || []).filter((t) => String(t?.id) !== idOf(app)),
    }));
    setEditing(null);
    setSaid(`Removed ${name}.`);
  };

  const items = apps.map((app) => {
    const id = idOf(app);
    const name = app.label || id;
    const word = embeddingWord(app, results[app.url]);
    const src = iconImageSrc(app.icon);
    return {
      id,
      name,
      lead: <AppIcon src={src ?? undefined} text={appMonogram(name)} />,
      title: name,
      subtitle: shortAddress(app.url),
      status: <CheckWord tone={word.tone}>{word.text}</CheckWord>,
      actions: (
        <>
          <Button
            variant="ghost"
            size="sm"
            tone="accent"
            aria-label={`Edit ${name}`}
            aria-expanded={editing === id}
            onClick={() => setEditing(editing === id ? null : id)}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Remove ${name}`}
            onClick={() => remove(app)}
          >
            Remove
          </Button>
        </>
      ),
      editor:
        editing === id ? (
          <AppEditor
            app={app}
            result={results[app.url]}
            onSave={(patch) => {
              // An address that is not saved yet is checked from the form, not as a saved app.
              if (patch.url !== app.url && !patch.newTab) {
                reserve(patch.url);
                checkEmbed(patch.url).then((r) => seed(patch.url, r));
              }
              replace(id, patch);
              setEditing(null);
              setSaid(`Saved ${patch.label}.`);
            }}
            onCancel={() => setEditing(null)}
          />
        ) : null,
    };
  });

  return (
    <Panel
      flush
      id="embedded-apps"
      className="settings-anchor"
      title="Embedded apps"
      description="Your embedded tabs. Each one sits in the sidebar, opens inside JagHelm under the status header, and stays loaded when you switch away."
      actions={
        <Button
          ref={addButton}
          variant={adding ? 'secondary' : 'primary'}
          size="sm"
          aria-expanded={adding}
          onClick={() => setAdding(!adding)}
        >
          {adding ? 'Close' : 'Add app'}
        </Button>
      }
    >
      {adding ? (
        <Tray>
          <AddApp tabs={tabs} checkEmbed={checkEmbed} onAdd={add} initial={initial} />
        </Tray>
      ) : null}
      {items.length === 0 ? (
        <Note inset>No apps yet. Add one to open it from the sidebar without leaving JagHelm.</Note>
      ) : null}
      <OrderedRows
        items={items}
        label="Embedded apps"
        onMove={(id, delta) => {
          const i = apps.findIndex((a) => idOf(a) === id);
          setApps(moved(apps, i, delta));
        }}
        onReorder={(from, to) => setApps(reordered(apps, idOf, from, to))}
      />
      <Announce>{said}</Announce>
    </Panel>
  );
}

const BLANK = { label: '', url: '', icon: '', newTab: false };

/** The add form, and what the embedding check said before the app is saved. */
function AddApp({ tabs, checkEmbed, onAdd, initial }) {
  const [form, setForm] = useState(initial?.form ?? BLANK);
  const [errors, setErrors] = useState({});
  // null; 'checking'; or { app, result } waiting for a choice.
  const [phase, setPhase] = useState(initial?.phase ?? null);
  // Counts edits: a check's answer is about the form as it was asked, so one
  // that arrives after an edit is dropped and the form is as the user left it.
  const edits = useRef(0);
  const set = (patch) => {
    edits.current += 1;
    setForm((f) => ({ ...f, ...patch }));
    setErrors({});
    setPhase(null);
  };

  const build = (newTab) => {
    const name = form.label.trim();
    const address = normalizeAddress(form.url);
    const found = {};
    if (!name) found.label = 'Give the app a name.';
    if (address.error) found.url = address.error;
    setErrors(found);
    if (Object.keys(found).length > 0) return null;
    return {
      id: newAppId(name, tabs),
      label: name,
      type: 'iframe',
      url: address.url,
      ...(form.icon ? { icon: form.icon } : {}),
      ...(newTab ? { newTab: true } : {}),
    };
  };

  const submit = async (e) => {
    e.preventDefault();
    if (phase === 'checking') return;
    const app = build(form.newTab);
    if (!app) return;
    // Opening in a new tab needs no frame: nothing to check.
    if (app.newTab) return onAdd(app, null);
    const asked = edits.current;
    setPhase('checking');
    const result = await checkEmbed(app.url);
    if (edits.current !== asked) return;
    if (result.verdict === 'allowed') return onAdd(app, result);
    setPhase({ app, result });
  };

  const result = phase && phase !== 'checking' ? phase.result : null;
  const chosen = phase && phase !== 'checking' ? phase.app : null;
  const name = chosen?.label ?? form.label.trim();

  return (
    <FormStack onSubmit={submit}>
      <FieldRow>
        <Field label="Name" error={errors.label}>
          <Input
            value={form.label}
            placeholder="Paperless"
            onChange={(e) => set({ label: e.target.value })}
          />
        </Field>
        <Field label="URL" error={errors.url}>
          <MonoInput
            value={form.url}
            placeholder="https://paperless.lan"
            onChange={(e) => set({ url: e.target.value })}
          />
        </Field>
        <IconSlot>
          <IconPicker compact value={form.icon} onChange={(icon) => set({ icon })} />
        </IconSlot>
      </FieldRow>
      <ToggleLine>
        <Switch checked={form.newTab} onCheckedChange={(on) => set({ newTab: on })} />
        Open in a new browser tab instead of inside JagHelm
      </ToggleLine>
      {result ? (
        <Column>
          <Banner
            tone={result.verdict === 'blocked' ? 'warn' : 'unknown'}
            title={
              result.verdict === 'blocked'
                ? `${name} won’t show inside JagHelm`
                : `JagHelm couldn’t check ${name}`
            }
            cause={
              result.verdict === 'blocked'
                ? `Its server tells browsers not to show it inside another site${result.header ? ` (${result.header})` : ''}. JagHelm can’t override that.`
                : `The check couldn’t read its headers${result.reason ? ` (${result.reason})` : ''}, so it may or may not embed.`
            }
          />
          <Actions>
            <Button variant="primary" onClick={() => onAdd({ ...chosen, newTab: true }, result)}>
              Open in a new tab instead
            </Button>
            <Button onClick={() => onAdd({ ...chosen, embedAnyway: true }, result)}>
              Add it inside JagHelm anyway
            </Button>
            <Button variant="ghost" onClick={() => setPhase(null)}>
              Back to edit
            </Button>
          </Actions>
        </Column>
      ) : (
        <Actions>
          <Button type="submit" variant="primary" disabled={phase === 'checking'}>
            {form.newTab ? 'Add app' : 'Check embedding and add'}
          </Button>
          <Note role="status">{phase === 'checking' ? 'Checking whether it embeds…' : ''}</Note>
        </Actions>
      )}
    </FormStack>
  );
}

/** One app's fields, saved as a whole; its URL is read as the add form reads it. */
function AppEditor({ app, result, onSave, onCancel }) {
  const [draft, setDraft] = useState({
    label: app.label ?? '',
    url: app.url ?? '',
    icon: app.icon ?? '',
    newTab: app.newTab === true,
  });
  const [errors, setErrors] = useState({});
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const save = (e) => {
    e.preventDefault();
    const name = draft.label.trim();
    const address = normalizeAddress(draft.url);
    const found = {};
    if (!name) found.label = 'Give the app a name.';
    if (address.error) found.url = address.error;
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onSave({
      label: name,
      url: address.url,
      icon: draft.icon || undefined,
      newTab: draft.newTab || undefined,
    });
  };
  return (
    <FormStack onSubmit={save}>
      <FieldRow>
        <Field label="Name" error={errors.label}>
          <Input value={draft.label} onChange={(e) => set({ label: e.target.value })} />
        </Field>
        <Field label="URL" error={errors.url}>
          <MonoInput value={draft.url} onChange={(e) => set({ url: e.target.value })} />
        </Field>
        <IconSlot>
          <IconPicker compact value={draft.icon} onChange={(icon) => set({ icon })} />
        </IconSlot>
      </FieldRow>
      <ToggleLine>
        <Switch checked={draft.newTab} onCheckedChange={(on) => set({ newTab: on })} />
        Open in a new browser tab instead of inside JagHelm
      </ToggleLine>
      {result?.verdict === 'blocked' && !draft.newTab ? (
        <Note tone="warn">
          This app blocks embedding. Switch on “Open in a new browser tab” to keep it in the sidebar
          as a link.
        </Note>
      ) : null}
      <Actions>
        <Button type="submit" variant="primary" size="sm">
          Save
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </Actions>
    </FormStack>
  );
}
