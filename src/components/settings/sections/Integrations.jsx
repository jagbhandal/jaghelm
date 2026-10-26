import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Plug } from 'lucide-react';
import { ShellSection } from '@ui/app-shell';
import { IntegrationForm, IntegrationList, PresetGallery } from '@ui/integrations';
import { useStatusFreshness } from '../../../shell/statusFreshness.js';
import { AUTH_LABELS } from './integrations/constants.js';
import { useConfigForm } from './integrations/useConfigForm.js';
import { useIntegrationActions } from './integrations/useIntegrationActions.js';
import { useIntegrationsData } from './integrations/useIntegrationsData.js';
import {
  categoryItems,
  displayName,
  galleryTiles,
  handWrittenNote,
  hasHandWritten,
  listRows,
  neededFields,
  presetOf,
  PRESETS_UNREAD,
  hasStoredSecrets,
  isRetired,
  isUnsupported,
} from './integrations/integrationsView.js';

/**
 * Settings → Integrations (#323, spec §7): the apps JagHelm reads headline
 * stats from, on the design system. Two parts on the page, "Connected" (what is
 * set up, with its live status from the header's poll, and Disable, Edit and
 * Remove on each row) and "Add an integration" (the presets, searchable by
 * name and category, and a custom builder); a preset, a custom builder or Edit
 * opens the configure form in place of both, with Test connection, Save and,
 * for an existing one, Remove.
 *
 * Every removal asks in the Confirm dialog, by the integration's display name
 * (src/ui/integrations.jsx), never its storage key. Secrets are never shown:
 * a stored password or token reads back as nothing and leaving its field blank
 * keeps it (the server merges the form into the stored entry, #402); what a
 * test or a refused save says is the server's sentence, with anything the
 * person typed blanked from it. What is read and sent is unchanged since the
 * tab it replaces (requests in integrations/useIntegrationActions.js, the
 * rows' words in integrations/integrationsView.js).
 */
export default function Integrations({ status = null, reach = 'loading', updated = null }) {
  const [view, setView] = useState('home'); // 'home' | 'config'
  const [selectedPreset, setSelectedPreset] = useState(null); // null = custom builder
  const [editingType, setEditingType] = useState(null); // the storage key being edited
  // Kept here so a form opened from the gallery and left keeps the filters.
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');

  const freshness = useStatusFreshness({ status, reach, updated });
  const { presets, presetsFailed, configured, configError, allContainers, loading, refetch } =
    useIntegrationsData();
  const form = useConfigForm();

  const nameOf = (key) => (presetsFailed ? key : displayName(key, configured[key], presets));
  const goHome = () => {
    setView('home');
    setSelectedPreset(null);
    setEditingType(null);
    refetch();
  };
  const actions = useIntegrationActions({
    selectedPreset,
    editingType,
    form,
    refetch,
    onAfterSave: goHome,
    nameOf,
  });
  const { setTestStatus, setSaveStatus } = actions;

  const openConfig = (preset, existingConfig = null, existingKey = null) => {
    setSelectedPreset(preset);
    setEditingType(existingKey || (existingConfig ? preset?.type || null : null));
    form.populate(preset, existingConfig);
    setTestStatus(null);
    setSaveStatus(null);
    setView('config');
  };

  if (view === 'config') {
    return (
      <ShellSection>
        <ConfigurePart
          preset={selectedPreset}
          presets={presets}
          presetsFailed={presetsFailed}
          editingType={editingType}
          entry={editingType ? configured[editingType] : null}
          name={editingType ? nameOf(editingType) : null}
          form={form}
          containers={allContainers}
          actions={actions}
          onBack={goHome}
          onRemoved={goHome}
        />
      </ShellSection>
    );
  }

  const rows = listRows({
    configured,
    presets,
    presetsFailed,
    containers: allContainers,
    status,
    freshness,
  });
  const edit = (key) => {
    const entry = configured[key];
    openConfig(presetOf(key, entry, presets), entry, key);
  };
  const pick = (type) => {
    const preset = presets.find((p) => p.type === type);
    openConfig(preset, configured[type] || null);
  };

  return (
    <ShellSection>
      <IntegrationList
        id="connected"
        className={ANCHOR}
        note={freshness.stale ? freshness.note : null}
        rows={rows}
        notice={presetsFailed && !configError ? PRESETS_UNREAD : null}
        loading={loading}
        unread={configError ? { error: configError, onRetry: refetch } : null}
        onToggle={(key) => actions.handleToggle(key, configured[key])}
        onEdit={edit}
        onRemove={(key) => actions.handleDelete(key)}
        onAdd={() => openConfig(null)}
      />
      {loading || configError ? null : (
        <GalleryPart
          presets={presets}
          configured={configured}
          search={search}
          setSearch={setSearch}
          category={category}
          setCategory={setCategory}
          onPick={pick}
          onCustom={() => openConfig(null)}
        />
      )}
    </ShellSection>
  );
}

Integrations.icon = <Plug />;

// A part a link opens at stops under the header (global.css).
const ANCHOR = 'settings-anchor';

function GalleryPart({
  presets,
  configured,
  search,
  setSearch,
  category,
  setCategory,
  onPick,
  onCustom,
}) {
  const tiles = useMemo(
    () => galleryTiles({ presets, configured, search, category }),
    [presets, configured, search, category]
  );
  const categories = useMemo(() => categoryItems(presets), [presets]);
  return (
    <PresetGallery
      id="add"
      className={ANCHOR}
      presets={tiles}
      total={presets.length}
      search={search}
      onSearch={setSearch}
      category={category}
      onCategory={setCategory}
      categories={categories}
      onPick={onPick}
      onCustom={onCustom}
    />
  );
}

/** The fields of one form: what a refusal names it shows beside, and focuses. */
function ConfigurePart({
  preset,
  presets,
  presetsFailed,
  editingType,
  entry,
  name,
  form,
  containers,
  actions,
  onBack,
  onRemoved,
}) {
  const { testStatus, setTestStatus, saveStatus, setSaveStatus } = actions;
  const isPreset = Boolean(preset);
  const isEditing = Boolean(editingType);
  const authType = preset?.auth || 'bearer';
  const needed = neededFields(preset);
  const presetName = preset?.name || 'Custom integration';
  const saveError = saveStatus && typeof saveStatus === 'object' ? saveStatus.error : null;
  const testError =
    testStatus && typeof testStatus === 'object' && !testStatus.ok ? testStatus.error : null;

  // A refusal of a Save or a Test shows beside the field it names, when the
  // form has it: a key taken by another integration is the instance name's to
  // fix (#414), a credential in the URL the URL's (#422), a password or token
  // to type again for a new address (#556) or one that names a stored secret
  // (#427), the password's or the token's.
  const besideField = (s) =>
    s?.field === 'url' ||
    (s?.field === 'instance' && isPreset) ||
    ((s?.field === 'password' || s?.field === 'token') && needed.includes(s.field));
  const errorBeside = (field) =>
    (saveError && saveStatus.field === field && besideField(saveStatus) ? saveError : null) ||
    (testError && testStatus.field === field && besideField(testStatus) ? testError : null);
  const instanceError = errorBeside('instance');
  const urlRefusal = errorBeside('url');
  const passwordError = errorBeside('password');
  const tokenError = errorBeside('token');
  // A stored URL that carries a credential is never shown (#422).
  const urlError =
    urlRefusal ||
    (form.urlStored && !form.url
      ? 'The stored URL carries a password or key, so it is not shown. Enter the URL without it, and the credential in its own field.'
      : null);
  /** Editing a field clears the refusal shown beside it: it was about the old value. */
  const clearRefusal = (field) => {
    if (saveStatus?.field === field) setSaveStatus(null);
    if (testStatus?.field === field) setTestStatus(null);
  };

  // Focus the field on each such refusal: Save is at the bottom of a form that
  // may be scrolled, and focusing the field brings its message into view. A
  // layout effect, so the field has focus in the same commit that shows the
  // message.
  const instanceRef = useRef(null);
  const urlRef = useRef(null);
  const passwordRef = useRef(null);
  const tokenRef = useRef(null);
  useLayoutEffect(() => {
    if (instanceError) instanceRef.current?.focus();
    else if (urlRefusal) urlRef.current?.focus();
    else if (passwordError) passwordRef.current?.focus();
    else if (tokenError) tokenRef.current?.focus();
  }, [saveStatus, testStatus, instanceError, urlRefusal, passwordError, tokenError]);

  const targetItems = useMemo(() => {
    const items = [
      { value: '', label: 'Auto-match (by name)' },
      ...containers.map((c) => ({ value: c.uid, label: `${c.name} — ${c.node}` })),
    ];
    // A target that isn't in the list (its node is down) stays chosen.
    if (form.target !== '' && !items.some((i) => i.value === form.target)) {
      items.push({ value: form.target, label: String(form.target) });
    }
    return items;
  }, [containers, form.target]);

  const keep = isEditing
    ? 'Stored encrypted on the server. Leave blank to keep it.'
    : 'Stored encrypted on the server.';
  const fields = [
    {
      id: 'url',
      label: 'Base URL',
      description:
        'The protocol is added if missing: adguard.local:3000 becomes http://adguard.local:3000.',
      value: form.url,
      onChange: (v) => {
        form.setUrl(v);
        clearRefusal('url');
      },
      placeholder: isPreset ? 'http://your-server:port' : 'https://service.example.com',
      error: urlError,
      inputRef: urlRef,
      mono: true,
      wide: true,
    },
    isPreset && {
      id: 'instance',
      label: 'Instance name',
      description: 'Optional. For a second copy of the same app (primary, secondary).',
      value: form.instance,
      onChange: (v) => {
        form.setInstance(v);
        // The message was about the name it no longer holds.
        clearRefusal('instance');
      },
      placeholder: 'e.g. primary',
      error: instanceError,
      inputRef: instanceRef,
      mono: true,
    },
    {
      id: 'target',
      kind: 'select',
      label: 'Target container',
      description:
        'Optional. Scopes its stats to one container; otherwise any container with a similar name.',
      value: form.target,
      items: targetItems,
      onChange: (v) => form.setTarget(v),
    },
    needed.includes('username') && {
      id: 'username',
      label: authType === 'oauth2' ? 'Client ID' : 'Username',
      value: form.username,
      onChange: form.setUsername,
      placeholder: authType === 'oauth2' ? 'OAuth2 client ID' : 'admin',
    },
    needed.includes('password') && {
      id: 'password',
      kind: 'secret',
      label: authType === 'oauth2' ? 'Client secret' : 'Password',
      description: keep,
      value: form.password,
      onChange: (v) => {
        form.setPassword(v);
        clearRefusal('password');
      },
      placeholder: isEditing ? '••••••••' : undefined,
      error: passwordError,
      inputRef: passwordRef,
    },
    needed.includes('token') && {
      id: 'token',
      kind: 'secret',
      label:
        authType === 'query'
          ? 'API key'
          : authType === 'header'
            ? `API key (${preset?.authHeader || 'X-API-Key'})`
            : 'API token',
      description: keep,
      value: form.token,
      onChange: (v) => {
        form.setToken(v);
        clearRefusal('token');
      },
      placeholder: isEditing ? '••••••••' : undefined,
      error: tokenError,
      inputRef: tokenRef,
      mono: true,
    },
    ...(preset?.urlParams ?? []).map((p) => ({
      id: `param-${p.key}`,
      label: p.label,
      value: form.params[p.key] ?? '',
      onChange: (v) => form.setParams((prev) => ({ ...prev, [p.key]: v })),
      placeholder: p.placeholder || p.label,
      mono: true,
    })),
    {
      id: 'enabled',
      kind: 'check',
      label: 'Enabled',
      description: 'Fetch its data on every refresh.',
      value: form.enabled,
      onChange: form.setEnabled,
      wide: true,
    },
  ].filter(Boolean);

  const notes = [];
  if (authType === 'none' && isPreset) {
    notes.push({ tone: 'info', title: 'No authentication', cause: 'Just the address is needed.' });
  }
  if (!isPreset) {
    notes.push(
      hasHandWritten(entry)
        ? {
            tone: 'info',
            title: 'Endpoint and fields are set in services.yaml',
            cause: handWrittenNote(entry),
          }
        : {
            tone: 'info',
            title: 'Endpoint and fields are set in services.yaml',
            cause:
              'This form sets the address and credentials. To read stats from the API, add its endpoint and data fields to the entry in services.yaml on the host.',
          }
    );
  }

  const test =
    testStatus === 'testing'
      ? { state: 'testing' }
      : testStatus && typeof testStatus === 'object' && !besideField(testStatus)
        ? testStatus.ok
          ? { state: 'ok', sentence: 'the integration answered.' }
          : { state: 'failed', sentence: testStatus.error }
        : null;

  const title = isEditing ? `Edit ${name}` : `Configure ${presetName}`;
  return (
    <IntegrationForm
      id="configure"
      title={title}
      description={
        isPreset
          ? `${preset.description ? `${preset.description} · ` : ''}Auth: ${AUTH_LABELS[authType] ?? authType}`
          : 'Any app with a JSON API.'
      }
      backLabel={isEditing ? 'Back to Connected' : 'Back to presets'}
      onBack={onBack}
      fields={fields}
      notes={notes}
      dataFields={isPreset ? (preset.fields ?? []).map((f) => f.label) : []}
      test={test}
      saveState={saveStatus === 'saving' || saveStatus === 'saved' ? saveStatus : null}
      saveError={saveError && !besideField(saveStatus) ? saveError : null}
      canSubmit={Boolean(form.url)}
      onTest={actions.handleTest}
      onSave={actions.handleSave}
      remove={
        isEditing
          ? {
              name,
              detail: presetsFailed
                ? undefined
                : preset
                  ? 'Preset'
                  : isRetired(editingType, entry)
                    ? 'No longer supported'
                    : isUnsupported(editingType, entry, presets)
                      ? 'Unsupported preset'
                      : 'Custom',
              secrets: hasStoredSecrets(entry),
              value: editingType,
              onRemove: async (key) => {
                if (await actions.handleDelete(key)) onRemoved();
              },
            }
          : null
      }
    />
  );
}
